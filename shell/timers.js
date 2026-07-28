import GLib from 'gi://GLib';

const MIN_TIMEOUT_SECONDS = 1;
const MAX_TIMEOUT_SECONDS = 30 * 24 * 60 * 60;

export function addTimeoutSeconds(name, seconds, callback) {
    const clampedSeconds = Math.max(MIN_TIMEOUT_SECONDS,
        Math.min(MAX_TIMEOUT_SECONDS, Math.ceil(seconds)));

    const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, clampedSeconds, () => {
        callback();
        return GLib.SOURCE_REMOVE;
    });

    GLib.Source.set_name_by_id(id, `[sunset-appearance] ${name}`);
    return id;
}

export function removeSource(sourceId) {
    if (sourceId)
        GLib.Source.remove(sourceId);

    return 0;
}
