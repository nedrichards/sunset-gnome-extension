import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {
    classifySolarState,
    describeLocationAge,
    isValidCoordinate,
    SCHEME_DARK,
} from './lib/solar.js';

const INTERFACE_SCHEMA = 'org.gnome.desktop.interface';
const COLOR_SCHEME_KEY = 'color-scheme';
const STATUS_REFRESH_SECONDS = 60;

function formatCoordinates(latitude, longitude, timestamp) {
    if (!timestamp)
        return 'No cached location';

    return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

function formatTime(date) {
    return new Intl.DateTimeFormat(undefined, {
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function formatScheme(scheme) {
    return scheme === SCHEME_DARK ? 'Dark' : 'Light or system default';
}

function statusLabel() {
    return new Gtk.Label({
        halign: Gtk.Align.END,
        valign: Gtk.Align.CENTER,
        xalign: 1,
        wrap: true,
        max_width_chars: 24,
    });
}

export default class SunsetAppearancePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const interfaceSettings = new Gio.Settings({schema_id: INTERFACE_SCHEMA});

        const statusPage = new Adw.PreferencesPage({
            title: 'Status',
            icon_name: 'dialog-information-symbolic',
        });
        window.add(statusPage);

        const scheduleGroup = new Adw.PreferencesGroup({
            title: 'Schedule',
        });
        statusPage.add(scheduleGroup);

        const currentAppearanceRow = new Adw.ActionRow({
            title: 'Current appearance',
        });
        const currentAppearanceLabel = statusLabel();
        currentAppearanceRow.add_suffix(currentAppearanceLabel);
        scheduleGroup.add(currentAppearanceRow);

        const currentPeriodRow = new Adw.ActionRow({
            title: 'Current solar period',
        });
        const currentPeriodLabel = statusLabel();
        currentPeriodRow.add_suffix(currentPeriodLabel);
        scheduleGroup.add(currentPeriodRow);

        const nextSwitchRow = new Adw.ActionRow({
            title: 'Next switch',
        });
        const nextSwitchLabel = statusLabel();
        nextSwitchRow.add_suffix(nextSwitchLabel);
        scheduleGroup.add(nextSwitchRow);

        const overrideRow = new Adw.ActionRow({
            title: 'Temporary override',
        });
        const overrideLabel = statusLabel();
        overrideRow.add_suffix(overrideLabel);
        scheduleGroup.add(overrideRow);

        const statusLocationGroup = new Adw.PreferencesGroup({
            title: 'Location',
        });
        statusPage.add(statusLocationGroup);

        const statusCoordinatesRow = new Adw.ActionRow({
            title: 'Cached coordinates',
        });
        const statusCoordinatesLabel = statusLabel();
        statusCoordinatesRow.add_suffix(statusCoordinatesLabel);
        statusLocationGroup.add(statusCoordinatesRow);

        const locationAgeRow = new Adw.ActionRow({
            title: 'Location age',
        });
        const locationAgeLabel = statusLabel();
        locationAgeRow.add_suffix(locationAgeLabel);
        statusLocationGroup.add(locationAgeRow);

        const refreshStatus = () => {
            const latitude = settings.get_double('cached-latitude');
            const longitude = settings.get_double('cached-longitude');
            const timestamp = Number(settings.get_int64('cached-location-timestamp'));
            const hasLocation = Boolean(timestamp) && isValidCoordinate(latitude, longitude);

            const temporaryOverride = settings.get_string('temporary-override');
            overrideLabel.set_label(temporaryOverride === 'none'
                ? 'None'
                : `${temporaryOverride === 'dark' ? 'Dark' : 'Light'} until next switch`);
            currentAppearanceLabel.set_label(formatScheme(
                interfaceSettings.get_string(COLOR_SCHEME_KEY)));
            statusCoordinatesLabel.set_label(formatCoordinates(latitude, longitude, timestamp));
            locationAgeLabel.set_label(timestamp
                ? describeLocationAge(timestamp)
                : 'No cached location');

            if (!hasLocation) {
                currentPeriodLabel.set_label('Waiting for a location');
                nextSwitchLabel.set_label('Unavailable');
                return;
            }

            const state = classifySolarState(new Date(), latitude, longitude);
            const period = state.isNight ? 'Night' : 'Day';
            currentPeriodLabel.set_label(state.period === 'always-night' || state.period === 'always-day'
                ? `${period} (polar conditions)`
                : period);

            if (!settings.get_boolean('automatic-switching')) {
                nextSwitchLabel.set_label('Automatic switching is off');
            } else if (state.nextTransition) {
                nextSwitchLabel.set_label(`${state.isNight ? 'Light' : 'Dark'} at ${formatTime(state.nextTransition)}`);
            } else {
                nextSwitchLabel.set_label('Rechecking at midnight');
            }
        };

        const statusSignalIds = [
            settings.connect('changed::automatic-switching', refreshStatus),
            settings.connect('changed::cached-latitude', refreshStatus),
            settings.connect('changed::cached-longitude', refreshStatus),
            settings.connect('changed::cached-location-timestamp', refreshStatus),
            settings.connect('changed::temporary-override', refreshStatus),
        ];
        const interfaceSignalId = interfaceSettings.connect(`changed::${COLOR_SCHEME_KEY}`, refreshStatus);
        const statusRefreshId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT,
            STATUS_REFRESH_SECONDS, () => {
                refreshStatus();
                return GLib.SOURCE_CONTINUE;
            });

        window.connect('close-request', () => {
            for (const signalId of statusSignalIds)
                settings.disconnect(signalId);
            interfaceSettings.disconnect(interfaceSignalId);
            GLib.Source.remove(statusRefreshId);
            return false;
        });

        refreshStatus();

        const page = new Adw.PreferencesPage({
            title: 'Settings',
            icon_name: 'emblem-system-symbolic',
        });
        window.add(page);

        const automationGroup = new Adw.PreferencesGroup({
            title: 'Automation',
        });
        page.add(automationGroup);

        const automaticRow = new Adw.SwitchRow({
            title: 'Automatic switching',
        });
        settings.bind('automatic-switching', automaticRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        automationGroup.add(automaticRow);

        const overrideModel = new Gtk.StringList();
        // Keep the selected value short: ComboRow gives the suffix only a
        // narrow column in the compact preferences window. The row subtitle
        // supplies the shared expiry detail instead of repeating it in every
        // option.
        overrideModel.append('Scheduled');
        overrideModel.append('Light');
        overrideModel.append('Dark');
        const overrideValues = ['none', 'light', 'dark'];
        const overrideControl = new Adw.ComboRow({
            title: 'Temporary appearance',
            subtitle: 'Ends at the next civil dawn or dusk',
            model: overrideModel,
            selected: overrideValues.indexOf(settings.get_string('temporary-override')),
        });
        overrideControl.connect('notify::selected', () => {
            settings.set_string('temporary-override', overrideValues[overrideControl.selected]);
        });
        settings.connect('changed::temporary-override', () => {
            const selected = overrideValues.indexOf(settings.get_string('temporary-override'));
            if (selected >= 0 && overrideControl.selected !== selected)
                overrideControl.selected = selected;
        });
        automationGroup.add(overrideControl);

        const debugRow = new Adw.SwitchRow({
            title: 'Debug logging',
        });
        settings.bind('debug-logging', debugRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        automationGroup.add(debugRow);

        const modeRow = new Adw.ActionRow({
            title: 'Transition',
            subtitle: 'Civil twilight',
        });
        modeRow.set_sensitive(false);
        automationGroup.add(modeRow);

        window.set_default_size(460, 360);
    }
}
