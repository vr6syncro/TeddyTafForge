#!/bin/sh

# Install plugin to TeddyCloud plugins directory (shared volume)
PLUGIN_ROOT="/teddycloud/data/www/plugins"
PLUGIN_DIR="$PLUGIN_ROOT/teddytafforge"
PLUGIN_SRC="/app/plugin"
if [ ! -d "$PLUGIN_ROOT" ]; then
    echo "Warning: TeddyCloud plugins dir not found, skipping plugin install"
elif [ ! -f "$PLUGIN_SRC/plugin.json" ] || [ ! -f "$PLUGIN_SRC/index.html" ]; then
    echo "Error: Plugin payload is missing plugin.json or index.html in $PLUGIN_SRC" >&2
    exit 1
else
    mkdir -p "$PLUGIN_DIR"
    cp -R "$PLUGIN_SRC"/. "$PLUGIN_DIR"/
    mkdir -p "$PLUGIN_DIR/covers"

    # Template the URL/Port into the plugin HTML
    if [ -n "$TAFFORGE_URL" ]; then
        sed -i "s|__TAFFORGE_URL__|${TAFFORGE_URL}|g" "$PLUGIN_DIR/index.html"
    fi
    if [ -n "$TAFFORGE_PORT" ]; then
        sed -i "s|__TAFFORGE_PORT__|${TAFFORGE_PORT}|g" "$PLUGIN_DIR/index.html"
    fi

    echo "Plugin installed to $PLUGIN_DIR"
fi

# Ensure custom_taf directory exists
mkdir -p /teddycloud/library/custom_taf

# Start the server
exec uvicorn backend.main:app --host 0.0.0.0 --port 3000
