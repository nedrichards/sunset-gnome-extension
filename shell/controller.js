import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    SCHEME_DARK,
    SCHEME_DEFAULT,
    classifySolarState,
    describeLocationAge,
    isValidCoordinate,
} from '../lib/solar.js';
import {
    didUserOverrideScheme,
    schemeForTemporaryOverride,
    shouldApplyScheme,
    shouldRestoreOnDisable,
} from '../lib/appearance-policy.js';
import {GeoclueLocationProvider} from './location-provider.js';
import {addTimeoutSeconds, removeSource} from './timers.js';

const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const COLOR_SCHEMA = 'org.gnome.settings-daemon.plugins.color';
const COLOR_SCHEME_KEY = 'color-scheme';
const NIGHT_LIGHT_COORDINATES_KEY = 'night-light-last-coordinates';

const LOGIND_BUS = 'org.freedesktop.login1';
const LOGIND_PATH = '/org/freedesktop/login1';
const LOGIND_MANAGER_IFACE = 'org.freedesktop.login1.Manager';

const DAILY_RESYNC_SECONDS = 24 * 60 * 60;

function unpackVariant(variant) {
    if (!variant)
        return null;

    return variant.deep_unpack();
}

function nowUnixSeconds() {
    return Math.floor(Date.now() / 1000);
}

function createProxyForBus(busType, name, objectPath, interfaceName, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.DBusProxy.new_for_bus(
            busType,
            Gio.DBusProxyFlags.NONE,
            null,
            name,
            objectPath,
            interfaceName,
            cancellable,
            (_source, result) => {
                try {
                    resolve(Gio.DBusProxy.new_for_bus_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
    });
}

export class SunsetAppearanceController {
    constructor(settings, extensionUuid) {
        this._settings = settings;
        this._interfaceSettings = new Gio.Settings({schema_id: INTERFACE_SCHEMA});

        this._baselineScheme = this._interfaceSettings.get_string(COLOR_SCHEME_KEY);
        this._lastAppliedScheme = null;
        this._manualOverride = false;
        this._temporaryOverride = this._settings.get_string('temporary-override');
        this._transitionTimeoutId = 0;
        this._dailyResyncTimeoutId = 0;
        this._settingsSignalIds = [];
        this._interfaceSignalId = 0;
        this._loginProxy = null;
        this._loginSignalId = 0;
        this._loginRequest = null;
        this._loginCancellable = null;
        this._location = this._loadCachedLocation();
        this._activeLocationRequest = null;
        this._locationProvider = new GeoclueLocationProvider(extensionUuid,
            message => this._debug(message));

        this._connectSettings();
        this._connectLogind();

        if (this._location)
            this._recomputeAndSchedule('cached-location', {forceTransition: false});
        else
            this._debug('No cached coordinates available yet');

        this._refreshLocation('enable');
        this._scheduleDailyResync();
    }

    destroy() {
        this._transitionTimeoutId = removeSource(this._transitionTimeoutId);
        this._dailyResyncTimeoutId = removeSource(this._dailyResyncTimeoutId);

        this._activeLocationRequest = null;
        this._locationProvider.destroy();

        this._loginRequest = null;
        this._loginCancellable?.cancel();
        this._loginCancellable = null;

        for (const signalId of this._settingsSignalIds)
            this._settings.disconnect(signalId);
        this._settingsSignalIds = [];

        this._interfaceSettings.disconnect(this._interfaceSignalId);
        this._interfaceSignalId = 0;

        if (this._loginSignalId) {
            this._loginProxy.disconnect(this._loginSignalId);
            this._loginSignalId = 0;
        }
        this._loginProxy = null;

        const currentScheme = this._interfaceSettings.get_string(COLOR_SCHEME_KEY);
        if (shouldRestoreOnDisable({
            manualOverride: this._manualOverride,
            lastAppliedScheme: this._lastAppliedScheme,
            baselineScheme: this._baselineScheme,
            currentScheme,
        })) {
            this._setColorScheme(this._baselineScheme, 'disable-restore');
        }

        this._locationProvider = null;
        this._settings = null;
        this._interfaceSettings = null;
        this._location = null;
    }

    _connectSettings() {
        this._settingsSignalIds.push(this._settings.connect('changed::automatic-switching', () => {
            this._debug('Automatic switching setting changed');
            this._recomputeAndSchedule('settings-change', {forceTransition: false});
        }));

        this._settingsSignalIds.push(this._settings.connect('changed::debug-logging', () => {
            this._debug('Debug logging setting changed');
        }));

        this._settingsSignalIds.push(this._settings.connect('changed::transition-mode', () => {
            this._debug('Transition mode setting changed');
            this._recomputeAndSchedule('settings-change', {forceTransition: false});
        }));

        this._settingsSignalIds.push(this._settings.connect('changed::temporary-override', () => {
            this._temporaryOverride = this._settings.get_string('temporary-override');
            this._debug(`Temporary override changed to ${this._temporaryOverride}`);

            if (this._temporaryOverride === 'none') {
                this._manualOverride = false;
                this._recomputeAndSchedule('temporary-override-cleared', {forceTransition: true});
            } else {
                this._applyTemporaryOverride();
                this._recomputeAndSchedule('temporary-override', {forceTransition: false});
            }
        }));

        this._interfaceSignalId = this._interfaceSettings.connect(`changed::${COLOR_SCHEME_KEY}`, () => {
            if (!this._lastAppliedScheme)
                return;

            const currentScheme = this._interfaceSettings.get_string(COLOR_SCHEME_KEY);
            if (didUserOverrideScheme(currentScheme, this._lastAppliedScheme)) {
                this._manualOverride = true;
                this._debug(`Manual color-scheme override detected: ${currentScheme}`);
            }
        });
    }

    async _connectLogind() {
        const request = Symbol('logind');
        const cancellable = new Gio.Cancellable();
        this._loginRequest = request;
        this._loginCancellable = cancellable;

        let proxy;
        try {
            proxy = await createProxyForBus(
                Gio.BusType.SYSTEM,
                LOGIND_BUS,
                LOGIND_PATH,
                LOGIND_MANAGER_IFACE,
                cancellable);
        } catch (error) {
            if (this._loginRequest === request) {
                this._loginRequest = null;
                this._loginCancellable = null;
                this._debug(`logind sleep signal unavailable: ${error.message}`);
            }
            return;
        }

        if (this._loginRequest !== request)
            return;

        this._loginRequest = null;
        this._loginCancellable = null;
        this._loginProxy = proxy;
        this._loginSignalId = proxy.connect('g-signal',
            (_proxy, _senderName, signalName, parameters) => {
                if (signalName !== 'PrepareForSleep')
                    return;

                const [goingToSleep] = parameters.deep_unpack();
                if (!goingToSleep)
                    this._onResume();
            });
    }

    _onResume() {
        this._debug('Resume detected; refreshing appearance state');
        this._refreshLocation('resume');
        this._recomputeAndSchedule('resume', {forceTransition: false});
    }

    _scheduleDailyResync() {
        this._dailyResyncTimeoutId = removeSource(this._dailyResyncTimeoutId);
        this._dailyResyncTimeoutId = addTimeoutSeconds('daily resync', DAILY_RESYNC_SECONDS, () => {
            this._dailyResyncTimeoutId = 0;
            this._refreshLocation('daily-resync');
            this._recomputeAndSchedule('daily-resync', {forceTransition: false});
            this._scheduleDailyResync();
        });
    }

    _loadCachedLocation() {
        const latitude = this._settings.get_double('cached-latitude');
        const longitude = this._settings.get_double('cached-longitude');
        const timestamp = Number(this._settings.get_int64('cached-location-timestamp'));

        if (!timestamp || !isValidCoordinate(latitude, longitude))
            return null;

        return {
            latitude,
            longitude,
            timestamp,
            source: 'extension-cache',
        };
    }

    _loadNightLightLocation() {
        let colorSettings;
        try {
            colorSettings = new Gio.Settings({schema_id: COLOR_SCHEMA});
        } catch (error) {
            this._debug(`Night Light settings unavailable: ${error.message}`);
            return null;
        }

        let value;
        try {
            value = colorSettings.get_value(NIGHT_LIGHT_COORDINATES_KEY);
        } catch (error) {
            this._debug(`Night Light coordinates unavailable: ${error.message}`);
            return null;
        }

        const coordinates = unpackVariant(value);
        if (!Array.isArray(coordinates) || coordinates.length < 2)
            return null;

        const [latitude, longitude] = coordinates;
        if (!isValidCoordinate(latitude, longitude))
            return null;

        if (latitude === 0 && longitude === 0)
            return null;

        return {
            latitude,
            longitude,
            timestamp: nowUnixSeconds(),
            source: 'night-light-cache',
        };
    }

    async _refreshLocation(reason) {
        const request = this._locationProvider.request();
        this._activeLocationRequest = request;

        try {
            const location = await request;
            if (this._activeLocationRequest !== request)
                return;

            this._setLocation(location);
            this._recomputeAndSchedule(`location-refresh:${reason}`, {forceTransition: false});
        } catch (error) {
            if (this._activeLocationRequest !== request)
                return;

            this._debug(`GeoClue location unavailable: ${error.message}`);
            const fallback = this._loadNightLightLocation();
            if (fallback) {
                this._setLocation(fallback);
                this._recomputeAndSchedule(`night-light-fallback:${reason}`, {forceTransition: false});
            } else if (!this._location) {
                this._transitionTimeoutId = removeSource(this._transitionTimeoutId);
                this._debug('No usable location source; leaving current appearance unchanged');
            }
        } finally {
            if (this._activeLocationRequest === request)
                this._activeLocationRequest = null;
        }
    }

    _setLocation(location) {
        if (!isValidCoordinate(location.latitude, location.longitude))
            return;

        const timestamp = location.timestamp || nowUnixSeconds();
        this._location = {
            latitude: location.latitude,
            longitude: location.longitude,
            timestamp,
            source: location.source,
        };

        this._settings.set_double('cached-latitude', location.latitude);
        this._settings.set_double('cached-longitude', location.longitude);
        this._settings.set_int64('cached-location-timestamp', timestamp);
        this._debug(`Using ${location.source} coordinates (${describeLocationAge(timestamp)})`);
    }

    _recomputeAndSchedule(reason, {forceTransition}) {
        this._transitionTimeoutId = removeSource(this._transitionTimeoutId);

        if (!this._settings.get_boolean('automatic-switching')) {
            this._debug(`Automatic switching disabled; skipped ${reason}`);
            return;
        }

        if (!this._location) {
            this._debug(`No location for ${reason}; skipped appearance update`);
            return;
        }

        const now = new Date();
        const state = classifySolarState(now, this._location.latitude, this._location.longitude);
        this._debug(`${reason}: ${state.period}; ${describeLocationAge(this._location.timestamp)}`);

        if (this._temporaryOverride === 'none')
            this._maybeApplyScheme(state.scheme, reason, {forceTransition});
        else
            this._applyTemporaryOverride();

        if (state.nextCheck) {
            const secondsUntilCheck = (state.nextCheck.getTime() - now.getTime()) / 1000;
            this._transitionTimeoutId = addTimeoutSeconds('next transition',
                secondsUntilCheck, () => {
                    this._transitionTimeoutId = 0;
                    if (this._temporaryOverride !== 'none') {
                        this._temporaryOverride = 'none';
                        this._settings.set_string('temporary-override', 'none');
                    }
                    this._manualOverride = false;
                    this._recomputeAndSchedule('scheduled-transition', {forceTransition: true});
                });
        }
    }

    _applyTemporaryOverride() {
        const scheme = schemeForTemporaryOverride(this._temporaryOverride,
            SCHEME_DEFAULT, SCHEME_DARK);

        if (!scheme)
            return;

        this._manualOverride = true;
        this._lastAppliedScheme = null;

        if (this._interfaceSettings.get_string(COLOR_SCHEME_KEY) !== scheme) {
            this._runScreenTransition();
            this._interfaceSettings.set_string(COLOR_SCHEME_KEY, scheme);
        }
    }

    _maybeApplyScheme(scheme, reason, {forceTransition}) {
        const decision = shouldApplyScheme({
            scheme,
            currentScheme: this._interfaceSettings.get_string(COLOR_SCHEME_KEY),
            manualOverride: this._manualOverride,
            forceTransition,
            validSchemes: [SCHEME_DARK, SCHEME_DEFAULT],
        });

        if (decision.action === 'ignore')
            return;

        if (decision.action === 'defer') {
            this._debug(`Manual override active; deferred ${scheme} for ${reason}`);
            return;
        }

        if (decision.action === 'record') {
            this._lastAppliedScheme = decision.lastAppliedScheme;
            return;
        }

        this._setColorScheme(scheme, reason);
    }

    _setColorScheme(scheme, reason) {
        this._lastAppliedScheme = scheme;
        this._manualOverride = false;
        this._runScreenTransition();
        this._interfaceSettings.set_string(COLOR_SCHEME_KEY, scheme);
        this._debug(`${reason}: set color-scheme to ${scheme}`);
    }

    _runScreenTransition() {
        // This is the same transition GNOME Shell's Dark Style Quick Settings
        // toggle starts immediately before changing color-scheme. GNOME Shell
        // 51 moved the transition from LayoutManager to Main; prefer its new
        // location and retain the old one for Shell 45–50.
        const screenTransition = Main.screenTransition ??
            Main.layoutManager.screenTransition;
        screenTransition.run();
    }

    _debug(message) {
        if (this._settings.get_boolean('debug-logging'))
            console.debug(`[sunset-appearance] ${message}`);
    }
}
