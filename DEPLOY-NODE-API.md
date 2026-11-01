# Deploy the Pointbreak Node.js API

The ride API and Socket.IO server already live in `server/`. InfinityFree can
serve the static web build, but it cannot run this Node.js process. Deploy this
API to a Node-capable VM or service that supports long-running processes,
Socket.IO/WebSockets, and a persistent writable disk.

## Required host settings

Configure these values in the host's private environment-variable settings:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | Use the port supplied by the host |
| `DB_PATH` | A file on persistent storage, e.g. `/var/data/pointbreak-rides-fiji.db` |
| `JWT_SECRET` | A private random value of at least 32 characters |
| `JWT_REFRESH_SECRET` | A different private random value of at least 32 characters |
| `ADMIN_PHONE` | Phone number for the initial admin account |
| `ADMIN_PASSWORD` | Private password for the initial admin account |
| `ADMIN_NAME` | Optional admin display name |
| `SEED_DEMO` | `false` |
| `DEMO_MODE` | `false` |
| `CORS_ORIGINS` | Exact public HTTPS origin of the InfinityFree website |

Generate secrets locally with `node scripts/gen-secrets.js` from the repository
root, then enter them directly into the host dashboard. Never commit or send
secrets in chat. Attach a persistent volume at the directory used by `DB_PATH`;
without it, a host restart or redeploy can erase accounts and ride history.

## Start the API

Deploy the contents of `server/` to the Node host. Use Node.js 20 or newer, then
run:

```sh
npm ci --omit=dev
npm start
```

The server binds to the host-provided `PORT`. Put HTTPS in front of it using the
host's managed TLS or a reverse proxy. Allow the public website origin in
`CORS_ORIGINS`; browser REST requests and Socket.IO use the same origin
allowlist. The hosting service must allow WebSocket upgrades and keep the Node
process running. Do not use a serverless/static-only product or an ephemeral
filesystem for this backend.

For a self-managed Ubuntu VM, the repository's Docker/Caddy deployment is
documented in [`DEPLOY-FREE.md`](DEPLOY-FREE.md). It serves the web app and API
on the same HTTPS origin, so it avoids cross-origin configuration.

## Verify before publishing

Check `https://<API_HOST>/api/health` returns HTTP 200 with `"ok":true`.
Then build the static web client for the API:

```powershell
$env:EXPO_PUBLIC_API_URL = "https://<API_HOST>"
npm --prefix mobile run export
```

Upload the resulting `mobile/dist/` contents to InfinityFree `htdocs`. The
origin is compiled into the web bundle. For an APK, configure the same HTTPS
origin in the EAS `preview` environment and build only after the health check
passes. Do not use localhost, a LAN IP, or a temporary tunnel in a published
build.

InfinityFree + a separate Node host is a starter arrangement, not a 24/7 or
million-user availability guarantee. The current backend uses a local SQLite
database and in-process ride matching; scaling it across multiple API instances
requires migrating to shared production database and realtime infrastructure.
