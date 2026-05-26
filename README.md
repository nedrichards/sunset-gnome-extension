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

## Product Decisions

The extension is deliberately small. It does one thing: it changes GNOME's existing colour-scheme preference at a natural point in the day. It does not try to replace Night Light, apply custom themes, control wallpaper, or manage application-specific dark modes.

### Use GNOME's Native Appearance Setting

The extension writes to:

```text
org.gnome.desktop.interface color-scheme
```

That means it uses the same platform preference exposed by GNOME Settings. Applications that follow GNOME's colour-scheme setting respond normally, and applications that ignore it are left alone. This keeps the extension predictable and avoids maintaining a separate theme system.

### Switch at Civil Dusk and Civil Dawn

The appearance changes are based on civil twilight rather than clock time, sunrise, sunset, or full darkness:

- Civil dusk sets the scheme to `prefer-dark`.
- Civil dawn sets the scheme back to `default`.

This makes the switch follow the user's actual place and season. A fixed time would be wrong for much of the year, especially at higher latitudes. Sunset alone is usually too early, because there can still be plenty of useful daylight. Nautical or astronomical twilight are usually too late for an interface preference, because they describe much darker conditions than the point where a desktop starts to feel like it belongs in evening mode.

### Ask for Location Briefly, Then Stop

The extension asks GeoClue for one coarse location fix when it starts, then stops the GeoClue client. It does not keep a continuous location subscription running in the background.

That choice is enough for this feature because civil dawn and dusk do not need second-by-second location tracking. A coarse fix gives a useful local solar schedule, while avoiding unnecessary long-running location activity.

### Reuse Night Light Coordinates as a Fallback

If GeoClue is unavailable, denied, or slow, the extension tries GNOME Night Light's cached coordinates. Night Light already needs similar location information to make a time-of-day display decision, so reusing its cached value makes the extension more resilient without asking the user to enter a city or latitude and longitude manually.

If neither GeoClue nor Night Light can provide usable coordinates, the extension leaves the current appearance unchanged. Guessing a location would make the feature feel unreliable, so the safer behaviour is to do nothing until a real location is available.

### Respect Manual Changes

If the user changes GNOME's appearance manually after the extension has applied a value, the extension treats that as intentional. It waits until the next scheduled dawn or dusk transition before changing the setting again.

This avoids a tug of war between the extension and the user. The extension handles the routine daily transition, but the user's explicit choice wins for the current period.

### Restore Carefully on Disable

When the extension is disabled, it restores the appearance that was active when the extension was enabled, but only if the current setting still matches the value the extension last applied. If the user has changed the setting manually, the extension leaves it alone.

That keeps disabling the extension reversible without overwriting a later user choice.

## Development

Compile the schema while running from a checkout:

```sh
glib-compile-schemas schemas
```

Run the solar calculation tests:

```sh
npm test
```

The test suite keeps London as an explicit reference case, then stress-tests the solar scheduling code across every IANA timezone exposed by the local Node/tzdata build. It also includes real-world Antarctic and Arctic locations, date-line longitudes, polar and tropical latitudes, DST boundaries, and awkward offset zones such as Lord Howe, Chatham, Marquesas, Newfoundland, Casablanca, Gaza, Tehran, Santiago, and Apia.

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
