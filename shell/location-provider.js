import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {isValidCoordinate} from '../lib/solar.js';
import {addTimeoutSeconds, removeSource} from './timers.js';

const GEOCLUE_BUS = 'org.freedesktop.GeoClue2';
const GEOCLUE_MANAGER_PATH = '/org/freedesktop/GeoClue2/Manager';
const GEOCLUE_CLIENT_IFACE = 'org.freedesktop.GeoClue2.Client';
const GEOCLUE_ACCURACY_CITY = 4;
const GEOCLUE_DBUS_TIMEOUT_MS = 2000;
const GEOCLUE_FIX_TIMEOUT_SECONDS = 10;

const ManagerProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.GeoClue2.Manager">
    <method name="GetClient">
      <arg type="o" direction="out" name="client"/>
    </method>
  </interface>
</node>`);

const ClientProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="${GEOCLUE_CLIENT_IFACE}">
    <method name="Start"/>
    <method name="Stop"/>
    <property name="Location" type="o" access="read"/>
  </interface>
</node>`);

const LocationProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.GeoClue2.Location">
    <property name="Latitude" type="d" access="read"/>
    <property name="Longitude" type="d" access="read"/>
  </interface>
</node>`);

const PropertiesProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
  <interface name="org.freedesktop.DBus.Properties">
    <method name="Set">
      <arg type="s" direction="in" name="interface_name"/>
      <arg type="s" direction="in" name="property_name"/>
      <arg type="v" direction="in" name="value"/>
    </method>
  </interface>
</node>`);

function nowUnixSeconds() {
    return Math.floor(Date.now() / 1000);
}

function getSystemBus(cancellable) {
    return new Promise((resolve, reject) => {
        Gio.bus_get(Gio.BusType.SYSTEM, cancellable, (_source, result) => {
            try {
                resolve(Gio.bus_get_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

function createProxy(ProxyType, connection, objectPath, cancellable) {
    return new Promise((resolve, reject) => {
        new ProxyType(
            connection,
            GEOCLUE_BUS,
            objectPath,
            (proxy, error) => {
                if (error) {
                    reject(error);
                    return;
                }

                proxy.set_default_timeout(GEOCLUE_DBUS_TIMEOUT_MS);
                resolve(proxy);
            },
            cancellable,
            Gio.DBusProxyFlags.NONE);
    });
}

class LocationRequest {
    constructor(desktopId, debug) {
        this._desktopId = desktopId;
        this._debug = debug;
        this._cancellable = new Gio.Cancellable();
        this._clientProxy = null;
        this._clientSignalId = 0;
        this._cancellableSignalId = 0;
        this._fixTimeoutId = 0;
        this._locationResolve = null;
        this._locationReject = null;
    }

    async run() {
        try {
            const connection = await getSystemBus(this._cancellable);
            const managerProxy = await createProxy(ManagerProxy, connection,
                GEOCLUE_MANAGER_PATH, this._cancellable);
            const [clientPath] = await managerProxy.GetClientAsync(this._cancellable);

            this._clientProxy = await createProxy(ClientProxy, connection,
                clientPath, this._cancellable);
            const propertiesProxy = await createProxy(PropertiesProxy, connection,
                clientPath, this._cancellable);

            await Promise.all([
                propertiesProxy.SetAsync(GEOCLUE_CLIENT_IFACE, 'DesktopId',
                    new GLib.Variant('s', this._desktopId), this._cancellable),
                propertiesProxy.SetAsync(GEOCLUE_CLIENT_IFACE, 'RequestedAccuracyLevel',
                    new GLib.Variant('u', GEOCLUE_ACCURACY_CITY), this._cancellable),
                propertiesProxy.SetAsync(GEOCLUE_CLIENT_IFACE, 'DistanceThreshold',
                    new GLib.Variant('u', 0), this._cancellable),
                propertiesProxy.SetAsync(GEOCLUE_CLIENT_IFACE, 'TimeThreshold',
                    new GLib.Variant('u', 0), this._cancellable),
            ]);

            await this._clientProxy.StartAsync(this._cancellable);
            const locationPath = await this._waitForLocationPath();
            const locationProxy = await createProxy(LocationProxy, connection,
                locationPath, this._cancellable);
            const latitude = locationProxy.Latitude;
            const longitude = locationProxy.Longitude;

            if (!isValidCoordinate(latitude, longitude))
                throw new Error('GeoClue returned invalid coordinates');

            return {
                latitude,
                longitude,
                timestamp: nowUnixSeconds(),
                source: 'geoclue',
            };
        } finally {
            this._clearLocationWait();
            await this._stopClient();
        }
    }

    cancel() {
        this._cancellable.cancel();
    }

    _waitForLocationPath() {
        return new Promise((resolve, reject) => {
            this._locationResolve = resolve;
            this._locationReject = reject;
            this._clientSignalId = this._clientProxy.connect('g-properties-changed', () => {
                this._resolveCachedLocationPath();
            });
            this._cancellableSignalId = this._cancellable.connect(() => {
                this._cancellableSignalId = 0;
                this._finishLocationWait(this._locationReject,
                    new Error('GeoClue request cancelled'));
            });
            this._fixTimeoutId = addTimeoutSeconds('geoclue fix timeout',
                GEOCLUE_FIX_TIMEOUT_SECONDS, () => {
                    this._fixTimeoutId = 0;
                    this._finishLocationWait(this._locationReject,
                        new Error('timed out waiting for GeoClue fix'));
                });

            this._resolveCachedLocationPath();
        });
    }

    _resolveCachedLocationPath() {
        const locationPath = this._clientProxy.Location;
        if (locationPath && locationPath !== '/')
            this._finishLocationWait(this._locationResolve, locationPath);
    }

    _finishLocationWait(callback, value) {
        if (!callback)
            return;

        this._locationResolve = null;
        this._locationReject = null;
        this._clearLocationWait();
        callback(value);
    }

    _clearLocationWait() {
        this._fixTimeoutId = removeSource(this._fixTimeoutId);

        if (this._clientSignalId) {
            this._clientProxy.disconnect(this._clientSignalId);
            this._clientSignalId = 0;
        }

        if (this._cancellableSignalId) {
            this._cancellable.disconnect(this._cancellableSignalId);
            this._cancellableSignalId = 0;
        }
    }

    async _stopClient() {
        const clientProxy = this._clientProxy;
        this._clientProxy = null;
        if (!clientProxy)
            return;

        try {
            await clientProxy.StopAsync();
        } catch (error) {
            if (!this._cancellable.is_cancelled())
                this._debug(`GeoClue Stop failed: ${error.message}`);
        }
    }
}

export class GeoclueLocationProvider {
    constructor(desktopId, debug) {
        this._desktopId = desktopId;
        this._debug = debug;
        this._activeRequest = null;
    }

    request() {
        this._activeRequest?.cancel();

        const request = new LocationRequest(this._desktopId, this._debug);
        this._activeRequest = request;

        return request.run().finally(() => {
            if (this._activeRequest === request)
                this._activeRequest = null;
        });
    }

    destroy() {
        const request = this._activeRequest;
        this._activeRequest = null;
        request?.cancel();
    }
}
