#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="sunset-appearance@nedrichards.com"
BUILD_DIR="$ROOT_DIR/build"
STAGING_DIR="$BUILD_DIR/$UUID"
ZIP_PATH="$BUILD_DIR/$UUID.shell-extension.zip"

rm -rf "$STAGING_DIR" "$ZIP_PATH"
mkdir -p "$STAGING_DIR"

cp "$ROOT_DIR/metadata.json" "$STAGING_DIR/"
cp "$ROOT_DIR/extension.js" "$STAGING_DIR/"
cp "$ROOT_DIR/prefs.js" "$STAGING_DIR/"
cp "$ROOT_DIR/README.md" "$STAGING_DIR/"
cp -R "$ROOT_DIR/lib" "$STAGING_DIR/"
cp -R "$ROOT_DIR/schemas" "$STAGING_DIR/"

glib-compile-schemas "$STAGING_DIR/schemas"

(
    cd "$STAGING_DIR"
    zip -qr "$ZIP_PATH" .
)

echo "$ZIP_PATH"
