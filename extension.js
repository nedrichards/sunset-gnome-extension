import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {
    SCHEME_DARK,
    SCHEME_DEFAULT,
    classifySolarState,
    describeLocationAge,
    isValidCoordinate,
} from './lib/solar.js';
import {
    didUserOverrideScheme,
    shouldApplyScheme,
    shouldRestoreOnDisable,
} from './lib/appearance-policy.js';

const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const COLOR_SCHEMA = 'org.gnome.settings-daemon.plugins.color';
const COLOR_SCHEME_KEY = 'color-scheme';
const NIGHT_LIGHT_COORDINATES_KEY = 'night-light-last-coordinates';

const GEOCLUE_BUS = 'org.freedesktop.GeoClue2';
const GEOCLUE_MANAGER_PATH = '/org/freedesktop/GeoClue2/Manager';
const GEOCLUE_MANAGER_IFACE = 'org.freedesktop.GeoClue2.Manager';
const GEOCLUE_CLIENT_IFACE = 'org.freedesktop.GeoClue2.Client';
const GEOCLUE_LOCATION_IFACE = 'org.freedesktop.GeoClue2.Location';
const DBUS_PROPERTIES_IFACE = 'org.freedesktop.DBus.Properties';
const GEOCLUE_ACCURACY_CITY = 4;
const GEOCLUE_DBUS_TIMEOUT_MS = 2000;
const GEOCLUE_FIX_TIMEOUT_SECONDS = 10;

const LOGIND_BUS = 'org.freedesktop.login1';
const LOGIND_PATH = '/org/freedesktop/login1';
const LOGIND_MANAGER_IFACE = 'org.freedesktop.login1.Manager';

const DAILY_RESYNC_SECONDS = 24 * 60 * 60;
const MIN_TIMEOUT_SECONDS = 1;
const MAX_TIMEOUT_SECONDS = 30 * 24 * 60 * 60;

function addTimeoutSeconds(name, seconds, callback) {
    const clampedSeconds = Math.max(MIN_TIMEOUT_SECONDS,
        Math.min(MAX_TIMEOUT_SECONDS, Math.ceil(seconds)));

    const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, clampedSeconds, () => {
        callback();
        return GLib.SOURCE_REMOVE;
    });

    if (GLib.Source?.set_name_by_id)
        GLib.Source.set_name_by_id(id, `[sunset-appearance] ${name}`);

    return id;
}

function removeSource(sourceId) {
    if (sourceId) {
        GLib.Source.remove(sourceId);
        return 0;
    }

    return sourceId;
}

function unpackVariant(variant) {
    if (!variant)
        return null;

    return variant.deep_unpack();
}

function nowUnixSeconds() {
    return Math.floor(Date.now() / 1000);
}

export default class SunsetAppearanceExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._interfaceSettings = new Gio.Settings({schema_id: INTERFACE_SCHEMA});

        this._baselineScheme = this._interfaceSettings.get_string(COLOR_SCHEME_KEY);
        this._lastAppliedScheme = null;
        this._manualOverride = false;
        this._transitionTimeoutId = 0;
        this._dailyResyncTimeoutId = 0;
        this._settingsSignalIds = [];
        this._interfaceSignalId = 0;
        this._loginProxy = null;
        this._loginSignalId = 0;
        this._location = this._loadCachedLocation();
        this._activeLocationRequest = null;
        this._cancelLocationRequest = null;
        this._destroyed = false;

        this._connectSettings();
        this._connectLogind();

        if (this._location)
            this._recomputeAndSchedule('cached-location', {forceTransition: false});
        else
            this._debug('No cached coordinates available yet');

        this._refreshLocation('enable');
        this._scheduleDailyResync();
    }

    disable() {
        this._destroyed = true;

        this._transitionTimeoutId = removeSource(this._transitionTimeoutId);
        this._dailyResyncTimeoutId = removeSource(this._dailyResyncTimeoutId);

        if (this._cancelLocationRequest) {
            this._cancelLocationRequest();
            this._cancelLocationRequest = null;
        }
        this._activeLocationRequest = null;

        for (const signalId of this._settingsSignalIds)
            this._settings.disconnect(signalId);
        this._settingsSignalIds = [];

        if (this._interfaceSignalId) {
            this._interfaceSettings.disconnect(this._interfaceSignalId);
            this._interfaceSignalId = 0;
        }

        if (this._loginProxy && this._loginSignalId) {
            this._loginProxy.disconnect(this._loginSignalId);
            this._loginSignalId = 0;
        }
        this._loginProxy = null;

        const currentScheme = this._interfaceSettings?.get_string(COLOR_SCHEME_KEY);
        if (shouldRestoreOnDisable({
            manualOverride: this._manualOverride,
            lastAppliedScheme: this._lastAppliedScheme,
            baselineScheme: this._baselineScheme,
            currentScheme,
        })) {
            this._setColorScheme(this._baselineScheme, 'disable-restore');
        }

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

    _connectLogind() {
        try {
            this._loginProxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SYSTEM,
                Gio.DBusProxyFlags.NONE,
                null,
                LOGIND_BUS,
                LOGIND_PATH,
                LOGIND_MANAGER_IFACE,
                null);

            this._loginSignalId = this._loginProxy.connect('g-signal',
                (_proxy, _senderName, signalName, parameters) => {
                    if (signalName !== 'PrepareForSleep')
                        return;

                    const [goingToSleep] = parameters.deep_unpack();
                    if (!goingToSleep)
                        this._onResume();
                });
        } catch (error) {
            this._debug(`logind sleep signal unavailable: ${error.message}`);
        }
    }

    _onResume() {
        if (this._destroyed)
            return;

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
        let colorSettings = null;

        try {
            colorSettings = new Gio.Settings({schema_id: COLOR_SCHEMA});
        } catch (error) {
            this._debug(`Night Light settings unavailable: ${error.message}`);
            return null;
        }

        let value = null;
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
        if (this._cancelLocationRequest)
            this._cancelLocationRequest();

        const requestId = Symbol(reason);
        this._activeLocationRequest = requestId;

        try {
            const location = await this._requestGeoclueLocation();
            if (this._destroyed || this._activeLocationRequest !== requestId)
                return;

            this._setLocation(location, 'geoclue');
            this._recomputeAndSchedule(`location-refresh:${reason}`, {forceTransition: false});
        } catch (error) {
            if (this._destroyed || this._activeLocationRequest !== requestId)
                return;

            this._debug(`GeoClue location unavailable: ${error.message}`);
            const fallback = this._loadNightLightLocation();
            if (fallback) {
                this._setLocation(fallback, fallback.source);
                this._recomputeAndSchedule(`night-light-fallback:${reason}`, {forceTransition: false});
            } else if (!this._location) {
                this._transitionTimeoutId = removeSource(this._transitionTimeoutId);
                this._debug('No usable location source; leaving current appearance unchanged');
            }
        }
    }

    _setLocation(location, source) {
        if (!isValidCoordinate(location.latitude, location.longitude))
            return;

        const timestamp = location.timestamp || nowUnixSeconds();

        this._location = {
            latitude: location.latitude,
            longitude: location.longitude,
            timestamp,
            source,
        };

        this._settings.set_double('cached-latitude', location.latitude);
        this._settings.set_double('cached-longitude', location.longitude);
        this._settings.set_int64('cached-location-timestamp', timestamp);
        this._debug(`Using ${source} coordinates (${describeLocationAge(timestamp)})`);
    }

    _requestGeoclueLocation() {
        return new Promise((resolve, reject) => {
            let clientProxy = null;
            let clientSignalId = 0;
            let timeoutId = 0;
            let settled = false;

            const cleanup = () => {
                if (timeoutId) {
                    GLib.Source.remove(timeoutId);
                    timeoutId = 0;
                }

                if (clientProxy && clientSignalId) {
                    clientProxy.disconnect(clientSignalId);
                    clientSignalId = 0;
                }

                if (clientProxy) {
                    try {
                        clientProxy.call_sync('Stop', null, Gio.DBusCallFlags.NONE,
                            GEOCLUE_DBUS_TIMEOUT_MS, null);
                    } catch (error) {
                        this._debug(`GeoClue Stop failed: ${error.message}`);
                    }
                }
            };

            const finish = (callback, value) => {
                if (settled)
                    return;

                settled = true;
                if (this._cancelLocationRequest === cancelRequest)
                    this._cancelLocationRequest = null;
                cleanup();
                callback(value);
            };

            const cancelRequest = () => {
                finish(reject, new Error('cancelled'));
            };
            this._cancelLocationRequest = cancelRequest;

            const tryReadLocation = () => {
                try {
                    const location = this._readGeoclueLocation(clientProxy);
                    if (location) {
                        finish(resolve, location);
                        return true;
                    }
                } catch (error) {
                    finish(reject, error);
                    return true;
                }

                return false;
            };

            try {
                const managerProxy = Gio.DBusProxy.new_for_bus_sync(
                    Gio.BusType.SYSTEM,
                    Gio.DBusProxyFlags.NONE,
                    null,
                    GEOCLUE_BUS,
                    GEOCLUE_MANAGER_PATH,
                    GEOCLUE_MANAGER_IFACE,
                    null);

                const [clientPath] = managerProxy.call_sync('GetClient', null,
                    Gio.DBusCallFlags.NONE, GEOCLUE_DBUS_TIMEOUT_MS, null).deep_unpack();

                clientProxy = Gio.DBusProxy.new_for_bus_sync(
                    Gio.BusType.SYSTEM,
                    Gio.DBusProxyFlags.NONE,
                    null,
                    GEOCLUE_BUS,
                    clientPath,
                    GEOCLUE_CLIENT_IFACE,
                    null);

                this._setRemoteProperty(clientPath, GEOCLUE_CLIENT_IFACE,
                    'DesktopId', new GLib.Variant('s', this.metadata.uuid));
                this._setRemoteProperty(clientPath, GEOCLUE_CLIENT_IFACE,
                    'RequestedAccuracyLevel', new GLib.Variant('u', GEOCLUE_ACCURACY_CITY));
                this._setRemoteProperty(clientPath, GEOCLUE_CLIENT_IFACE,
                    'DistanceThreshold', new GLib.Variant('u', 0));
                this._setRemoteProperty(clientPath, GEOCLUE_CLIENT_IFACE,
                    'TimeThreshold', new GLib.Variant('u', 0));

                clientSignalId = clientProxy.connect('g-properties-changed', () => {
                    tryReadLocation();
                });

                clientProxy.call_sync('Start', null, Gio.DBusCallFlags.NONE,
                    GEOCLUE_DBUS_TIMEOUT_MS, null);

                if (tryReadLocation())
                    return;

                timeoutId = addTimeoutSeconds('geoclue fix timeout',
                    GEOCLUE_FIX_TIMEOUT_SECONDS, () => {
                        timeoutId = 0;
                        finish(reject, new Error('timed out waiting for GeoClue fix'));
                    });
            } catch (error) {
                finish(reject, error);
            }
        });
    }

    _setRemoteProperty(objectPath, interfaceName, propertyName, value) {
        const connection = Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
        connection.call_sync(
            GEOCLUE_BUS,
            objectPath,
            DBUS_PROPERTIES_IFACE,
            'Set',
            new GLib.Variant('(ssv)', [interfaceName, propertyName, value]),
            null,
            Gio.DBusCallFlags.NONE,
            GEOCLUE_DBUS_TIMEOUT_MS,
            null);
    }

    _readGeoclueLocation(clientProxy) {
        const locationPath = unpackVariant(clientProxy.get_cached_property('Location'));
        if (!locationPath || locationPath === '/')
            return null;

        const locationProxy = Gio.DBusProxy.new_for_bus_sync(
            Gio.BusType.SYSTEM,
            Gio.DBusProxyFlags.NONE,
            null,
            GEOCLUE_BUS,
            locationPath,
            GEOCLUE_LOCATION_IFACE,
            null);

        const latitude = unpackVariant(locationProxy.get_cached_property('Latitude'));
        const longitude = unpackVariant(locationProxy.get_cached_property('Longitude'));

        if (!isValidCoordinate(latitude, longitude))
            return null;

        return {
            latitude,
            longitude,
            timestamp: nowUnixSeconds(),
            source: 'geoclue',
        };
    }

    _recomputeAndSchedule(reason, {forceTransition}) {
        this._transitionTimeoutId = removeSource(this._transitionTimeoutId);

        if (!this._settings?.get_boolean('automatic-switching')) {
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

        this._maybeApplyScheme(state.scheme, reason, {forceTransition});

        if (state.nextCheck) {
            const secondsUntilCheck = (state.nextCheck.getTime() - now.getTime()) / 1000;
            this._transitionTimeoutId = addTimeoutSeconds('next transition',
                secondsUntilCheck, () => {
                    this._transitionTimeoutId = 0;
                    this._manualOverride = false;
                    this._recomputeAndSchedule('scheduled-transition', {forceTransition: true});
                });
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
        this._interfaceSettings.set_string(COLOR_SCHEME_KEY, scheme);
        this._debug(`${reason}: set color-scheme to ${scheme}`);
    }

    _debug(message) {
        if (this._settings?.get_boolean('debug-logging'))
            console.debug(`[sunset-appearance] ${message}`);
    }
}
