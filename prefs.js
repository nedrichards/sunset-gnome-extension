import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function formatCoordinates(latitude, longitude, timestamp) {
    if (!timestamp)
        return 'No cached location';

    return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

export default class SunsetAppearancePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Sunset Appearance',
            icon_name: 'weather-clear-night-symbolic',
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

        const locationGroup = new Adw.PreferencesGroup({
            title: 'Location',
        });
        page.add(locationGroup);

        const locationRow = new Adw.ActionRow({
            title: 'Cached coordinates',
        });
        locationGroup.add(locationRow);

        const updateLocationRow = () => {
            locationRow.subtitle = formatCoordinates(
                settings.get_double('cached-latitude'),
                settings.get_double('cached-longitude'),
                Number(settings.get_int64('cached-location-timestamp')));
        };

        const signalIds = [
            settings.connect('changed::cached-latitude', updateLocationRow),
            settings.connect('changed::cached-longitude', updateLocationRow),
            settings.connect('changed::cached-location-timestamp', updateLocationRow),
        ];

        window.connect('close-request', () => {
            for (const signalId of signalIds)
                settings.disconnect(signalId);
            return false;
        });

        updateLocationRow();

        window.set_default_size(460, 360);
    }
}
