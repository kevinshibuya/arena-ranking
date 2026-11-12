# Cloudflare proxies the site; Caddy serves a Cloudflare Origin CA certificate

`kevinshibuya.com` is already on Cloudflare DNS, and the site is to be Open to the public on a box that also runs other services. The hostname is proxied through Cloudflare for its free WAF, bot protection, rate limiting and DDoS absorption; Caddy terminates TLS with a fifteen-year Cloudflare Origin CA certificate mounted from `~/apps/caddy/certs/`, and Cloudflare's SSL mode is Full (strict). The other sites on the box keep their Let's Encrypt path untouched.

## Considered options

- DNS-only with Let's Encrypt, as the other sites on the box: no edge protection, and the app's own limits would be the only ones.
- Proxied with Let's Encrypt behind the proxy: the HTTP challenge through Cloudflare is fragile and the DNS challenge needs a Caddy build with the Cloudflare module.
- Proxied plus a firewall admitting 80/443 only from Cloudflare's ranges: Docker's port publishing bypasses `ufw`, and the rules would also cut the bare-IP catch-all and any future direct site.

## Consequences

- The client address reaches the API only if Caddy trusts Cloudflare's ranges and passes `CF-Connecting-IP`; without that, the per-client "update now" limit treats every visitor as one. The Cloudflare IP list in the Caddyfile is static and has to be refreshed when Cloudflare changes it.
- Caddy's compose file on the box gains one read-only mount for the certificate directory.
