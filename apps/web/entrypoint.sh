#!/bin/sh
set -e
cat > /usr/share/nginx/html/config.js <<EOF
window.__APP_CONFIG__ = { VITE_API_URL: "${VITE_API_URL:-}" };
EOF
exec "$@"
