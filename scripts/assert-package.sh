#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="$ROOT_DIR/build/sunset-appearance@nedrichards.com.shell-extension.zip"

EXPECTED=(
    COPYING
    extension.js
    lib/appearance-policy.js
    lib/solar.js
    metadata.json
    prefs.js
    schemas/gschemas.compiled
    schemas/org.gnome.shell.extensions.sunset-appearance.gschema.xml
    shell/controller.js
    shell/location-provider.js
    shell/timers.js
)

mapfile -t ACTUAL < <(unzip -Z1 "$ARCHIVE" | sed '/\/$/d' | sort)
mapfile -t EXPECTED_SORTED < <(printf '%s\n' "${EXPECTED[@]}" | sort)

if ! diff -u <(printf '%s\n' "${EXPECTED_SORTED[@]}") <(printf '%s\n' "${ACTUAL[@]}"); then
    echo "Unexpected extension archive contents" >&2
    exit 1
fi

echo "extension archive contents passed"
