#!/bin/sh
set -eu

config_file="/usr/share/nginx/html/env-config.js"
supabase_url="${VITE_SUPABASE_URL:-${SUPABASE_URL:-}}"
supabase_publishable_key="${VITE_SUPABASE_PUBLISHABLE_KEY:-${SUPABASE_PUBLISHABLE_KEY:-}}"

escape_js_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

cat > "$config_file" <<EOF
globalThis.__KYBERROCK_LOADER_CONFIG__ = {
  supabaseUrl: "$(escape_js_string "$supabase_url")",
  supabasePublishableKey: "$(escape_js_string "$supabase_publishable_key")"
};
EOF
