#!/bin/sh
# Runs from the nginx image's /docker-entrypoint.d before nginx starts and
# writes the site config for APP_ORIGIN (the address users open, set by
# compose.yaml):
#
# - http://...  serves the site on port 80 only, as before.
# - https://... serves the site on port 443 with a self-signed certificate
#   (the course server guide's Option A: HKU IT cannot issue certificates)
#   and redirects port 80 to APP_ORIGIN. Google sign-in needs this, because
#   Google only accepts an https redirect URI for a non-localhost host.
#   /api/health stays on plain HTTP so the Compose health check and the
#   deploy script can reach it without the certificate.
#
# The certificate lives on the web_certs volume and is reissued when it is
# missing, within 30 days of expiry, or issued for another host name.
# No HSTS header: with a self-signed certificate HSTS would stop browsers
# from offering the "continue anyway" button.

set -eu

conf=/etc/nginx/conf.d/default.conf
snippets=/etc/nginx/clubspace
origin="${APP_ORIGIN:-}"

log() { printf 'clubspace-site: %s\n' "$*"; }

case "$origin" in
  https://*) ;;
  *)
    log "APP_ORIGIN is ${origin:-unset}; serving HTTP on port 80 only"
    cat > "$conf" <<EOF
server {
    listen 80;
    server_name _;
    include $snippets/locations.conf;
}
EOF
    exit 0
    ;;
esac

# APP_ORIGIN is pasted into the config below, so allow only what an origin
# (scheme, host, optional port) can contain.
case "$origin" in
  *[!A-Za-z0-9.:/-]* | */*/*/*)
    log "APP_ORIGIN must be scheme://host[:port] with no path: $origin" >&2
    exit 1
    ;;
esac

host=${origin#https://}
host=${host%%:*}
if [ -z "$host" ]; then
  log "APP_ORIGIN has no host name: $origin" >&2
  exit 1
fi

cert_dir=/etc/nginx/certs
crt=$cert_dir/server.crt
key=$cert_dir/server.key
mkdir -p "$cert_dir"

if [ ! -s "$crt" ] || [ ! -s "$key" ] \
  || [ "$(cat "$cert_dir/hostname" 2>/dev/null || true)" != "$host" ] \
  || ! openssl x509 -in "$crt" -noout -checkend 2592000 >/dev/null 2>&1; then
  log "issuing a self-signed certificate for $host"
  (
    umask 077
    openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
      -keyout "$key.tmp" -out "$crt.tmp" \
      -subj "/CN=$host" -addext "subjectAltName=DNS:$host" 2>/dev/null
  )
  chmod 644 "$crt.tmp"
  mv "$key.tmp" "$key"
  mv "$crt.tmp" "$crt"
  printf '%s\n' "$host" > "$cert_dir/hostname"
fi

log "serving HTTPS for $origin; port 80 redirects there"
cat > "$conf" <<EOF
server {
    listen 80;
    server_name _;

    location = /api/health {
        resolver 127.0.0.11 valid=10s ipv6=off;
        set \$backend http://backend:3000;
        proxy_pass \$backend;
        proxy_set_header Host \$host;
    }

    location / {
        return 301 $origin\$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name _;

    ssl_certificate $crt;
    ssl_certificate_key $key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:1m;
    ssl_session_timeout 1h;

    include $snippets/locations.conf;
}
EOF
