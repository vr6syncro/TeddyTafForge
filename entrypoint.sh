#!/bin/sh
set -eu

ensure_writable_dir() {
    target="$1"
    hint="$2"

    if [ ! -d "$target" ]; then
        echo "Error: required directory missing: $target ($hint)" >&2
        exit 1
    fi

    if [ ! -w "$target" ]; then
        echo "Error: $target is not writable by uid $(id -u) gid $(id -g)." >&2
        echo "Hint: adjust ownership/permissions of the mounted TeddyCloud volume or recreate it for the non-root container user." >&2
        exit 1
    fi
}

# Install plugin to TeddyCloud plugins directory (shared volume)
PLUGIN_DIR="/teddycloud/data/www/plugins/teddytafforge"
if [ -d "/teddycloud/data/www/plugins" ]; then
    ensure_writable_dir "/teddycloud/data/www/plugins" "shared TeddyCloud plugins volume"
    mkdir -p "$PLUGIN_DIR"
    cp -r /app/plugin/* "$PLUGIN_DIR/"

    # Template the URL/Port into the plugin HTML
    if [ -n "$TAFFORGE_URL" ]; then
        sed -i "s|__TAFFORGE_URL__|${TAFFORGE_URL}|g" "$PLUGIN_DIR/index.html"
    fi
    if [ -n "$TAFFORGE_PORT" ]; then
        sed -i "s|__TAFFORGE_PORT__|${TAFFORGE_PORT}|g" "$PLUGIN_DIR/index.html"
    fi

    echo "Plugin installed to $PLUGIN_DIR"
else
    echo "Warning: TeddyCloud plugins dir not found, skipping plugin install"
fi

# Ensure custom_taf directory exists
ensure_writable_dir "/teddycloud/library" "shared TeddyCloud library volume"
mkdir -p /teddycloud/library/custom_taf

# Project metadata and custom tonies live in the shared config volume.
if [ -d "/teddycloud/config" ]; then
    ensure_writable_dir "/teddycloud/config" "shared TeddyCloud config volume"
fi

# Start the server
exec uvicorn backend.main:app --host 0.0.0.0 --port 3000
