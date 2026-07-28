import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {SunsetAppearanceController} from './shell/controller.js';

export default class SunsetAppearanceExtension extends Extension {
    enable() {
        this._controller = new SunsetAppearanceController(
            this.getSettings(), this.metadata.uuid);
    }

    disable() {
        this._controller.destroy();
        this._controller = null;
    }
}
