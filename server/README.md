# Pointbreak Rides Fiji — Server

Backend for the Pointbreak Rides Fiji ride-hailing app. Built with Node.js, Express, sql.js (SQLite in WASM, persisted to a file), Socket.IO for realtime driver/rider matching, JWT auth, and bcryptjs.

## Requirements

- Node.js >= 18

## Run

```bash
cd server
npm install
npm start
```

The server listens on `http://localhost:3003` (override with `PORT`). On first start it creates `pointbreak-rides-fiji.db`, initializes the schema, and seeds demo users, drivers, and places.

## Demo credentials

| Role   | Phone       | Password    | Notes                          |
| ------ | ----------- | ----------- | ------------------------------ |
| Rider  | +679 7770001 | rider123    | "Jone Vaka"                   |
| Driver | +679 9001001 | driver123   | "Ratu Driving" (online)       |
| Driver | +679 9001002..9001006 | driver123 | More offline demo drivers |

## REST API

- `POST /api/auth/register` — body: `{ name, phone, password, role: 'rider'|'driver' }`
- `POST /api/auth/login` — body: `{ phone, password }` → `{ user, accessToken, refreshToken }`
- `POST /api/auth/refresh` — body: `{ refreshToken }`
- `GET /api/health` — service health check
- `GET /api/places` — list available places
- `POST /api/rides/estimate` — body: `{ pickupPlaceId, dropoffPlaceId }` → fare + route path
- `POST /api/rides` — body: `{ pickupPlaceId, dropoffPlaceId }` → creates ride, starts matching
- `GET /api/rides` — rider/driver ride history
- `GET /api/rides/:id` — ride detail
- `POST /api/rides/:id/cancel` — cancel a requested/accepted ride
- `POST /api/rides/:id/rate` — body: `{ rating: 1-5 }` (rider, completed rides only)
- `POST /api/drivers/status` — body: `{ status: 'online'|'offline' }`
- `GET /api/drivers/active` — driver's current ride (if busy)
- `POST /api/drivers/location` — body: `{ lat, lng }`

Protected endpoints use `Authorization: Bearer <accessToken>`.

## Socket.IO events

Client → server:

- `identify` — `{ token }` → server replies `identified`
- `driver_location` — `{ rideId, lat, lng }`
- `driver_accept` — `{ rideId }`
- `driver_decline` — `{ rideId }`
- `driver_arrived` — `{ rideId }`
- `driver_start_trip` — `{ rideId }`
- `driver_complete_trip` — `{ rideId }`
- `rider_cancel` — `{ rideId }`

Server → clients:

- `ride_request` (driver), `ride_searching` (rider)
- `ride_status` (rider, full ride object), `ride_cancelled` (driver)
- `ride_location_update` (rider), `ride_completed` (rider)

## Fare model

Base FJ$2.50, FJ$1.20/km, FJ$0.30/min, minimum FJ$4.00.

## Folders

- `src/config/` — database, JWT, schema, places, seed data
- `src/middleware/` — auth + rate limiting
- `src/rides/` — fare calc and the driver matching engine
- `src/routes/` — auth, rides, drivers routers
- `src/realtime.js` — socket connection handling
## Production deployment

Run with Docker Compose (API + Caddy automatic HTTPS):

1. `cp .env.example .env` and fill it in (`node scripts/gen-secrets.js` makes the JWT secrets).
2. Set `SITE_DOMAIN` and `ACME_EMAIL`; Caddy obtains a Let's Encrypt certificate.
3. `./scripts/prepare-fiji-maps.sh` (one-off; downloads the Fiji OSM extract).
4. `docker compose --profile maps up -d --build`

A complete $0/month walkthrough (free VM, DNS, backups) is in
[`../DEPLOY-FREE.md`](../DEPLOY-FREE.md).

The container builds the rider/driver web app and serves it at `/`, the API at
`/api`, and the admin dashboard at `/admin`. `/download` is the install page
(PWA + optional Android APK); see `../DEPLOY-FREE.md` §9.

Production safety checks (the server refuses to start if these are wrong):
`NODE_ENV=production` requires `JWT_SECRET` and `JWT_REFRESH_SECRET` (32+ chars,
different, not placeholders). Demo users are only seeded when `SEED_DEMO=true`;
on an empty database with demo seeding off, the first admin is created from
`ADMIN_PHONE`/`ADMIN_PASSWORD`. `DEMO_MODE=true` re-enables the pickup-code
reveal endpoint. `CORS_ORIGINS` is a comma-separated browser allowlist (native
apps send no Origin).

Maps run as free self-hosted containers — see `../DEPLOY-FREE.md`. Prepare the
data once with `./scripts/prepare-fiji-maps.sh`, set `OSRM_URL`/`NOMINATIM_URL`
in `.env`, then start with `docker compose --profile maps up -d --build`.
Without them the API falls back to straight-line estimates and "Dropped pin"
labels. The public Nominatim/OSRM demo servers are development-only (not
licensed for production traffic), and MapTiler's free tier is non-commercial.
`MOBILE_WEB_DIR` overrides where the web build is served from. `TRUST_PROXY=false`
disables X-Forwarded-For handling when not behind a proxy.