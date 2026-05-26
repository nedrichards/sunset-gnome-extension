# Sunset Appearance

A GNOME Shell extension for GNOME Shell 45 to 50 that switches GNOME's native appearance preference at civil twilight.

At civil dusk it sets:

```text
org.gnome.desktop.interface color-scheme = 'prefer-dark'
```

At civil dawn it sets:

```text
org.gnome.desktop.interface color-scheme = 'default'
```

The extension asks GeoClue for one coarse location fix when it starts, then stops the GeoClue client. If GeoClue is unavailable, denied, or slow, it falls back to GNOME Night Light's cached coordinates. If neither source has usable coordinates, the extension leaves the current appearance unchanged.

Manual changes are respected. If the appearance setting is changed away from the value the extension last applied, the extension waits until the next scheduled dawn or dusk transition before changing it again.

## Why Civil Twilight?

Sunset is not a single instant for practical use. After the sun drops below the horizon, the sky passes through recognised twilight stages based on how far the centre of the sun is below the horizon:

- **Civil twilight**: from sunset until the sun is 6 degrees below the horizon, and from 6 degrees below the horizon until sunrise in the morning. There is usually still enough natural light for normal outdoor activity.
- **Nautical twilight**: from 6 to 12 degrees below the horizon. The horizon becomes difficult to distinguish, but there is still visible light in the sky.
- **Astronomical twilight**: from 12 to 18 degrees below the horizon. After this, the sky is as dark as it is going to get for astronomical observation.

This extension uses civil dusk and civil dawn because the goal is not to model full darkness. It is to switch GNOME's appearance when the environment starts to feel like evening, and to switch back when daylight has returned enough for a light interface to make sense. Civil twilight is the earliest of the standard twilight thresholds, so it matches that human-facing transition better than nautical or astronomical twilight.

Using civil twilight also avoids making dark mode arrive very late in summer at higher latitudes. Waiting for nautical or astronomical dusk can be noticeably delayed, or may not happen at all in some places and seasons. Civil twilight gives a more predictable appearance change while still being based on the user's real location and date.

## Development

Compile the schema while running from a checkout:

```sh
glib-compile-schemas schemas
```

Run the pure solar calculation tests:

```sh
npm test
```

Build an installable extension zip:

```sh
npm run package
```

The zip is written to `build/sunset-appearance@nedrichards.com.shell-extension.zip`.

## Local Install

For a source install:

```sh
UUID=sunset-appearance@nedrichards.com
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
mkdir -p "$DEST"
rsync -a --delete metadata.json extension.js prefs.js lib schemas "$DEST/"
glib-compile-schemas "$DEST/schemas"
gnome-extensions enable "$UUID"
```

Restart GNOME Shell or log out and back in if the extension is not visible immediately.
