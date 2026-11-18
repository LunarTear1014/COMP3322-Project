# 0002 — Serve the HKU deployment over HTTPS with a self-signed certificate

Google only accepts `https` redirect URIs for hosts other than localhost, so Google sign-in (ADR 0001) cannot run on `http://c3322-pg19.cs.hku.hk`. HKU IT cannot issue certificates, so the course server guide offers a self-signed certificate (Option A) or plain HTTP (Option B). We switched from Option B to Option A: the web container issues a self-signed certificate for the `APP_ORIGIN` host on first start, keeps it on the `web_certs` volume, serves the site on 443 and redirects port 80 to `APP_ORIGIN`.

Google only redirects the user's browser to the callback; it never connects to the server. A host that is reachable only on HKUVPN, with an untrusted certificate, therefore works once the user has accepted the certificate warning.

## Considered options

- **Keep HTTP and skip Google sign-in on the server**: rejected, because Google sign-in is a feature we want to show on the deployed site.
- **Generate the certificate in the README deploy steps** (the guide's sample `openssl` command on the host): rejected. Marking redeploys with `docker compose up -d --build` alone, so a missing `certs/` folder would break nginx. Issuing the certificate inside the container keeps that single command working.
- **A tunnel or a public domain with a trusted certificate**: rejected. It is out of the course server's scope, and the server is reachable only on HKUVPN anyway.

## Consequences

- The scheme of `APP_ORIGIN` decides the mode. `https://` (the default) gives HTTPS plus a redirect from port 80. `http://` gives the old plain-HTTP site, which keeps local rebuilds such as `http://localhost:8080` working.
- Session cookies are Secure exactly when `APP_ORIGIN` is `https://`. `SESSION_COOKIE_SECURE` can still override this.
- Browsers show a certificate warning once per browser. No HSTS header is sent, because HSTS would remove the browser's option to proceed past an untrusted certificate.
- `/api/health` stays reachable over plain HTTP on port 80 for the Compose health check and the deploy script.
