#!/bin/sh

# Install plugin to TeddyCloud plugins directory (shared volume)
PLUGIN_DIR="/teddycloud/data/www/plugins/teddytafforge"
if [ -d "/teddycloud/data/www/plugins" ]; then
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
mkdir -p /teddycloud/library/custom_taf

# Start the server
exec uvicorn backend.main:app --host 0.0.0.0 --port 3000
