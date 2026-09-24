#!/bin/sh
set -eu

config_file="/usr/share/nginx/html/env-config.js"
supabase_url="${VITE_SUPABASE_URL:-${SUPABASE_URL:-}}"
supabase_publishable_key="${VITE_SUPABASE_PUBLISHABLE_KEY:-${SUPABASE_PUBLISHABLE_KEY:-}}"

# Aviso claro no log do container quando falta configuracao, em vez de gerar um env-config vazio
# em silencio (o app cairia no projeto Supabase default com chave invalida).
if [ -z "$supabase_url" ] || [ -z "$supabase_publishable_key" ]; then
  echo "[KyberRock] AVISO: SUPABASE_URL e/ou SUPABASE_PUBLISHABLE_KEY nao definidos. O loader-web nao vai conseguir autenticar ate configura-los no ambiente do container." >&2
fi

escape_js_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

cat > "$config_file" <<EOF
globalThis.__KYBERROCK_LOADER_CONFIG__ = {
  supabaseUrl: "$(escape_js_string "$supabase_url")",
  supabasePublishableKey: "$(escape_js_string "$supabase_publishable_key")"
};
EOF
