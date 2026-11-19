# Caddy with the DuckDNS DNS plugin, so it can get a certificate for a name on port 8443
# without needing ports 80 or 443 (Strata's Caddy holds those on this box).
FROM caddy:2.10-builder-alpine AS build
RUN xcaddy build --with github.com/caddy-dns/duckdns

FROM caddy:2.10-alpine
COPY --from=build /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
