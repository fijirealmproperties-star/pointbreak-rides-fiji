# Pointbreak Rides Fiji — the $0/month deployment

Everything this app needs runs on one free VM with no paid APIs:

| Piece | What runs it | Cost |
| --- | --- | --- |
| App + HTTPS | Node/sql.js/Socket.IO in Docker, Caddy + Let's Encrypt | $0 |
| Road routing (fares, route lines) | Self-hosted **OSRM** with the Fiji OSM extract | $0 |
| Reverse geocoding ("pin → street") | Self-hosted **Nominatim** with the same extract | $0 |
| Basemap | **OpenFreeMap** vector tiles via MapLibre GL (no key, no limits) | $0 |
| Server | Oracle Cloud **Always Free** (Ampere A1: 4 OCPU / 24 GB) | $0 |
| Domain | DuckDNS subdomain (or `sslip.io` with the raw IP) | $0 |
| Push/builds | Expo Push; `expo run:android` / `eas build --local` | $0 |
| Distribution | Installable **PWA** — `/` is the app, `/download` is the install page | $0 |

The only optional paid items are the app stores (Google Play US$25 once, Apple
US$99/year) and a custom `.fj`/`.com` domain. Skip both by shipping the PWA.

Why self-host the maps? The public OSM/Nominatim/OSRM demo servers are not
licensed for production, and commercial map providers (MapTiler, Stadia, CARTO,
Mapbox…) require a paid plan for commercial use. Self-hosting is the only
combination that is both free and allowed for a business.

---

## 1. Create the free VM

Oracle Cloud → **Always Free** → Ampere A1 (ARM) is the best fit:

- 4 OCPU / 24 GB RAM is enough to build the app image *and* run Nominatim.
- 2 × AMD micro instances (1 GB each) also work, but you must build the image
  elsewhere (see §7) and skip Nominatim.

Pick **Ubuntu 24.04 (aarch64)**. After it boots:

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git curl nodejs rclone
sudo usermod -aG docker "$USER"
```

`docker-compose-v2` is the package that provides `docker compose` (with a space);
`docker-compose` (hyphen) is the dead Python v1. Both are in `universe`, which the
Oracle Ubuntu image enables — if apt says *Unable to locate package*, run
`sudo add-apt-repository universe && sudo apt update` first. On a freshly booted
instance apt may be holding the dpkg lock while `unattended-upgrades` runs; wait a
minute and re-run. These distro packages are deliberate: Docker CE's own repo
conflicts with `docker.io`, and nothing here needs anything newer than 24.0.
`nodejs` is only for `scripts/gen-secrets.js` — the app itself runs in the
container — and `rclone` only for the optional off-site copy in §4.

The new group membership applies only to a **new** session, and the command must
name your user — inside a `sudo -i` shell `$USER` is root and you end up adding
the wrong account. Reconnect, then check:

```bash
exit                                      # or close/reopen the SSH session
id -nG | grep -qw docker && echo "docker group ok"
docker compose version                    # must print v2.x, not "not a docker command"
docker run --rm hello-world               # daemon, image pull and networking
```

`permission denied ... /var/run/docker.sock` means the recreate step was skipped,
not that the install failed (`newgrp docker` fixes it for one shell).

Open **80** and **443** in both the Oracle VCN security list and the host:

```bash
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw --force enable
sudo ufw status verbose
```

`--force` skips ufw's "may disrupt existing ssh connections" prompt, which
otherwise hangs the pasted block. The VCN security list (Subnet → Security List →
Add Ingress Rule, source `0.0.0.0/0`, TCP 80 and 443) is separate from ufw and
lives in the Oracle console; opening only one of the two still times out. If both
are open and it still times out, some Oracle images also ship a persistent
iptables ruleset that survives ufw — check `sudo iptables -L INPUT -n` for a
REJECT rule.

> Oracle reclaims idle Always Free instances. Keep the app running (it is), and
> don't leave the instance stopped for long periods.

## 2. Point a free hostname at it

`pointbreak-rides.duckdns.org` below is an **example**. DuckDNS names belong to
an account, so you must create the one you actually use — typing this exact name
without creating it gives `ERR_NAME_NOT_RESOLVED` in the browser, which looks
like a server problem but is pure DNS. Pick yours, then:

1. Get the VM's public IP (the Oracle console shows it, or ask the box):

   ```bash
   curl -4 -s https://ifconfig.me; echo
   ```

2. Sign in at duckdns.org and **add the subdomain** — the update API only changes
   the IP of a name that is already on your account, it does not create one. Then
   set the IP from the box, using the token from the top of the dashboard:

   ```bash
   SUB=pointbreak-rides                  # your subdomain, no .duckdns.org
   TOKEN=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   IP=$(curl -4 -s https://ifconfig.me)

   curl -s "https://www.duckdns.org/update?domains=$SUB&token=$TOKEN&ip=$IP&verbose=true"
   ```

   The reply is three lines — `OK`, the stored IP, then `UPDATED` or `NOCHANGE`:

   ```
   OK
   203.0.113.10
   UPDATED
   ```

   `KO` means the update was rejected: wrong token, or a subdomain that is not on
   the account. Curl exits 0 on `KO` too, so the body is the only check. The URL
   must stay quoted or the shell treats `&` as "run in background". Dropping
   `&ip=` entirely also works — DuckDNS then stores the address the request came
   from, which on this VM is the public IP. The token is a password: it ends up in
   your shell history, so don't paste the command into screenshots or issues.
   (On Windows, PowerShell's `curl` is an alias for `Invoke-WebRequest` and this
   URL will not work; run it on the VM.)

3. Verify before deploying anything — ask a public resolver, so your own
   machine's cache cannot lie to you:

   ```bash
   nslookup "$SUB.duckdns.org" 1.1.1.1
   ```

   `nslookup` ships in `bind9-dnsutils`, which the minimal Ubuntu image may not
   have (`sudo apt install -y bind9-dnsutils`). With only curl — same question,
   works on the VM and in PowerShell as `curl.exe`:

   ```bash
   curl -s -H "accept: application/dns-json" \
     "https://cloudflare-dns.com/dns-query?name=$SUB.duckdns.org&type=A"
   ```

   Success is `"Status":0` plus an `"Answer"` whose `data` is your VM's IP;
   `"Status":3` is NXDOMAIN. In `nslookup` output the **first** `Address:` is the
   resolver you asked (`1.1.1.1`) — only the second one is your record, an easy
   thing to misread. On Windows the equivalent is
   `Resolve-DnsName "$SUB.duckdns.org" -Server 1.1.1.1`, followed by
   `ipconfig /flushdns` — a cached negative answer survives the fix. Wrong IP
   means the DuckDNS entry is stale (re-run the update); NXDOMAIN means the name
   was never created. DuckDNS's negative TTL is 10 minutes (SOA minimum 600), so
   after creating or fixing a name, wait that long before deciding it failed.

No DNS at all? Use `sslip.io`, which encodes the IP in the name — nothing to
create, nothing to expire: `SITE_DOMAIN=203.0.113.10.sslip.io` (the real IP this
time, not that example). HTTPS still works, but you cannot move IPs later.

Whatever name you end up with, it must match in three places in `.env`:
`SITE_DOMAIN` (bare host, no `https://`), `ACME_EMAIL`, and
`CORS_ORIGINS=https://<same-host>`. Caddy reads `SITE_DOMAIN` when its container
starts, so after editing `.env` run `docker compose up -d caddy`.

## 3. Deploy

```bash
git clone <your-repo-url> pointbreak && cd pointbreak
cp .env.example .env && chmod 600 .env
node scripts/gen-secrets.js          # prints three lines to paste into .env

nano .env
#   SITE_DOMAIN=pointbreak-rides.duckdns.org
#   ACME_EMAIL=you@example.com
#   CORS_ORIGINS=https://pointbreak-rides.duckdns.org
#   JWT_SECRET=...            (from gen-secrets)
#   JWT_REFRESH_SECRET=...    (from gen-secrets, must differ)
#   ADMIN_PHONE=+679...       (your number — the first admin login)
#   ADMIN_PASSWORD=...        (from gen-secrets)
#   SEED_DEMO=false  DEMO_MODE=false
#   OSRM_URL=http://osrm:5000
#   NOMINATIM_URL=http://nominatim:8080

# the shell does not read .env; build the origin for the checks below
SITE_URL=$(sed -n 's/^SITE_DOMAIN=//p' .env | tr -d '\r')
case "$SITE_URL" in http://* | https://*) ;; *) SITE_URL="https://$SITE_URL" ;; esac

docker compose config --quiet            # .env parses, nothing is misspelled
bash scripts/prepare-fiji-maps.sh        # ~17 MB download, then the OSRM graph
docker compose --profile maps up -d --build
```

`<your-repo-url>` must be a repo that actually exists — push this one to GitHub
first (public is simplest; §7 covers the image). `.env` holds the JWT signing
keys and the first admin password, hence `600` and gitignored: never commit it.
`ADMIN_PHONE`/`ADMIN_PASSWORD` are read **once**, while the database has no
users: leave either empty with `SEED_DEMO=false` and the API exits at boot
(`docker compose logs pointbreak-api` says which one is missing), and changing
them later has no effect — use `/admin` instead. The shell does not read `.env`,
so `$SITE_URL` is built by hand for the checks below; in a new terminal, re-run
those three lines.

`prepare-fiji-maps.sh` writes only to `data/` (OSRM graph + the PBF that
Nominatim imports) and `data/` is in `.dockerignore`, so it is not uploaded as
build context. Re-running it is safe: the download is reused and an existing
graph is left alone.

The first `--build` compiles the Expo web bundle inside the image and the first
start imports the Fiji extract into Nominatim — a few minutes each on one OCPU.
Watch both at once (Ctrl-C stops the log view, not the containers):

```bash
docker compose --profile maps logs -f --tail 50 nominatim pointbreak-api
```

`logs` takes **service** names (`nominatim`, `pointbreak-api`), not the
`container_name` — `docker compose logs pointbreak-rides-fiji` says "no such
service"; for that name use `docker logs -f pointbreak-rides-fiji`. Two separate
`logs -f` lines pasted together do not work either: the first one blocks, so the
second never starts until you interrupt it.

Until the import finishes, reverse geocoding answers `"Dropped pin"` and fares
use straight-line distance; both start working on their own once it completes,
no restart needed. Re-run the smoke test below to see when.

Check it:

```bash
curl -sS --max-time 10 "$SITE_URL/api/health"
# {"ok":true,"service":"pointbreak-rides-fiji","time":"2026-…Z"}

# one command for the whole stack: edge, PWA, login, geocoding, routing
bash scripts/smoke-test.sh "$SITE_URL"
```

`-sS`, not `-s`: plain `-s` also hides the error message, so an unset variable
or a blocked port prints *nothing* and looks like a hang. `--max-time` stops a
filtered 443 from sitting there. A `502` means Caddy is up and the API container
is not. `smoke-test.sh` also accepts no argument — it reads `SITE_DOMAIN` from
`.env` and prepends `https://` itself.

`smoke-test.sh` prints PASS/FAIL/SKIP per check and exits non-zero on failure.
It registers one throwaway rider (`+6798……`) you can delete from `/admin`, or
reuse an existing account with `SMOKE_PHONE=… SMOKE_PASSWORD=… bash scripts/smoke-test.sh …`.
A `"Dropped pin"` label or a straight-line estimate means the `maps` profile is
not up or `NOMINATIM_URL` / `OSRM_URL` are wrong.

Manual checks, if you prefer:

```bash
# geocoding (Nominatim) — only answers once the import has finished
docker compose exec nominatim curl -sS \
  "http://localhost:8080/reverse?format=jsonv2&lat=-17.7765&lon=177.4356"

# routing (OSRM) — from the API container, over the same hostname the app uses
docker compose exec pointbreak-api wget -qO- \
  "http://osrm:5000/route/v1/driving/177.4356,-17.7765;177.4194,-17.6841?overview=false"
```

The first must contain a `display_name`; until the import completes it is a
connection error, not a wrong answer. The second must say `"code":"Ok"` with a
`distance` around 11–13 km: `"code":"NoRoute"` means the graph is missing or was
built from the wrong PBF, and a refused connection means the container is not up
(`docker compose --profile maps ps`). OSRM takes **longitude first** — swapped
coordinates come back as `InvalidQuery`, not a route in the sea.

`wget` is used for the second because the API image's healthcheck already proves
it exists (busybox), and it resolves `osrm` exactly as `OSRM_URL` does. The
API-level version of both checks — auth token, `"routed":true`, fare — is what
`smoke-test.sh` sections 4 and 5 do.

The rider/driver web app is at `/`, the admin dashboard at `/admin`.

## 4. Backups (free)

Everything that matters is the one SQLite file in the `pointbreak_data` volume.
The map data in `data/` is re-downloadable, and Caddy re-issues certificates, so
they are not worth backing up.

Install the daily job. Cron runs as root from `/` with a minimal `PATH`, so the
script path must be absolute — `scripts/backup.sh` `cd`s to the repo itself, so
`docker compose` still finds the compose file. The file must also be executable
and have no extension: `run-parts` skips anything else.

```bash
APP_DIR="$HOME/pointbreak"          # where you cloned it; re-run this if you move it
sudo tee /etc/cron.daily/pointbreak-backup >/dev/null <<EOF
#!/bin/sh
exec sh "$APP_DIR/scripts/backup.sh" >>/var/log/pointbreak-backup.log 2>&1
EOF
sudo chmod +x /etc/cron.daily/pointbreak-backup

sudo docker compose version        # root must see compose too; cron has no ~/.docker
sudo /etc/cron.daily/pointbreak-backup; sudo tail -n 3 /var/log/pointbreak-backup.log
```

Note the `;` rather than `&&` before `tail`: when the backup fails, that log is
the only place the reason appears.

`scripts/backup.sh` writes `/var/backups/pointbreak/app-YYYY-MM-DD.db`, keeps 14
days, and never stops the app. It copies the file inside the container first
(the API rewrites the whole database on every write, so a bare `docker cp` can
catch it mid-write), verifies the SQLite header, then renames into place.
Override with `BACKUP_DIR`, `BACKUP_KEEP_DAYS`, `SERVICE`, `DB_FILE`.

By hand it needs `sudo` too, because `/var/backups` is root-owned — without it
the run stops at `ERROR: cannot create /var/backups/pointbreak`. `sudo sh
scripts/backup.sh` works from any directory, or keep it user-owned with
`BACKUP_DIR="$HOME/backups" sh scripts/backup.sh` (then point `restore.sh` at
that path as well — not at the clone itself, so the backups survive a re-clone).

Restore one:

```bash
ls -l /var/backups/pointbreak          # pick a date that is actually there
sh scripts/restore.sh /var/backups/pointbreak/app-2026-10-26.db
```

There is no confirmation prompt and no dry run, so check the filename first: this
replaces every account, driver and ride with the contents of that file. The API
is stopped for the few seconds it takes.

It rejects the file *before* stopping anything unless it is a Pointbreak SQLite
database (header plus a `users` table in the schema), keeps what is live right
now at `$BACKUP_DIR/app-pre-restore.db` (or `~/pointbreak-pre-restore.db` when
`/var/backups` is not writable for your user), copies the backup in, fixes
ownership (the app runs as `node`, `docker cp` writes as root), restarts, then
polls `/api/health` for 30 s. If the API does not come back, it exits non-zero
and prints the rollback command instead of claiming success.

Undo a restore with the safety copy — the file it just replaced:

```bash
cp /var/backups/pointbreak/app-pre-restore.db /var/backups/pointbreak/keep.db   # optional
sh scripts/restore.sh /var/backups/pointbreak/app-pre-restore.db
```

That slot holds **one** restore's worth: each run overwrites it with whatever was
live at the time. Copy it aside first if you may need to go back two steps. And
the stack must have been started once already, or the script stops at `no
container for pointbreak-api`. If you cannot keep a safety copy at all,
`FORCE=1 sh scripts/restore.sh …` overrides that check.

### Off-site copy (Oracle Object Storage)

A backup on the same disk is not a backup. Oracle's Always Free tier includes
10 GB of object storage — far more than the 14 days kept on the box — and
`rclone` is installed in §1.

In the console, create the bucket (**Storage → Buckets → Create bucket**) in the
same region as the VM, since Always Free resources are tied to your home region,
and leave it **private** (the app database holds real phone numbers). Then make a
**Customer Secret Key**: *Profile → My profile → Customer secret keys → Add secret
key*. The key and secret are shown once.

rclone talks to the S3-compatible endpoint, so no OCI SDK config is involved:

```ini
# ~/.config/rclone/rclone.conf — chmod 600 after creating it: it holds the secret
[oracle]
type = s3
provider = Other
env_auth = false
access_key_id = <key>
secret_access_key = <secret>
region = ap-sydney-1
endpoint = https://<namespace>.compat.objectstorage.ap-sydney-1.oraclecloud.com
acl = private
```

`<namespace>` is on **Tenancy details → Object Storage settings**; the region in
the endpoint must match the bucket. `rclone config` builds the same file
interactively (storage `s3`, provider *Any other S3 compatible provider*).

```bash
rclone lsd oracle:                                  # auth works, bucket list
rclone copy /var/backups/pointbreak oracle:pointbreak-backups
rclone lsf oracle:pointbreak-backups                # one object per day
```

(`rclone mkdir oracle:pointbreak-backups` creates the bucket instead, if you
prefer that to the console — but only ever in the region you configured.)

Then daily. `run-parts` goes alphabetically, so `pointbreak-backup` runs before
this one and the day's file already exists:

```bash
RCLONE_CONF="$HOME/.config/rclone/rclone.conf"
sudo tee /etc/cron.daily/pointbreak-offsite >/dev/null <<EOF
#!/bin/sh
rclone --config "$RCLONE_CONF" copy /var/backups/pointbreak oracle:pointbreak-backups >>/var/log/pointbreak-backup.log 2>&1
EOF
sudo chmod +x /etc/cron.daily/pointbreak-offsite
sudo /etc/cron.daily/pointbreak-offsite; sudo tail -n 5 /var/log/pointbreak-backup.log
```

`--config` is not optional: this runs as root, whose `$HOME` is `/root`, so root's
rclone has no `oracle:` remote. Without it the upload fails into the log *after*
the local backup has already reported success — the one failure mode you would
never notice.

`copy`, never `sync`: `copy` never deletes, so the bucket keeps every daily
snapshot after the 14-day local prune — that is your long history. Failures are
otherwise silent, so glance at `rclone lsf oracle:pointbreak-backups | tail -1`
now and then; `rclone check /var/backups/pointbreak oracle:pointbreak-backups`
compares hashes if you want proof.

If the disk is gone, restore straight from the bucket (clone the repo again
first, §3 — `scripts/restore.sh` lives in it):

```bash
rclone copy oracle:pointbreak-backups/app-2026-10-26.db /tmp/pb/
sh scripts/restore.sh /tmp/pb/app-2026-10-26.db
sudo /etc/cron.daily/pointbreak-backup        # repopulate the local history
```

## 5. Updates

```bash
cd ~/pointbreak
git pull --ff-only
docker compose --profile maps up -d --build
```

`--ff-only` makes a locally edited checkout stop instead of turning the pull into
a merge commit that every later pull has to untangle. The build runs before any
container is replaced, so a broken build leaves the running app alone; the
downtime is just the recreate, a few seconds. Expect several minutes on one OCPU
— a 1 GB AMD micro cannot do this, which is what §7 is for.

Then prove it came back, and reclaim the disk:

```bash
bash scripts/smoke-test.sh          # no argument: reads SITE_DOMAIN from .env
docker image prune -f               # the image this build replaced; volumes untouched
```

Broken update? Go back one commit and rebuild:

```bash
git log --oneline -5
git checkout <previous-sha>
docker compose --profile maps up -d --build
git switch main
```

Running the published image (§7)? Keep the `git pull` — Compose, the Caddyfile
and the scripts still come from git — but skip the build; the image carries the
app code:

```bash
docker compose pull pointbreak-api
docker compose --profile maps up -d --no-build
```

and the same rollback works by pinning `:sha-<commit>` (every CI build is tagged
with its commit) instead of `:latest` in `docker-compose.override.yml`.

Map data refreshes: delete `data/fiji-latest.osm.pbf` and `data/nominatim`, then
re-run `bash scripts/prepare-fiji-maps.sh` and bring the stack up again. OSM edits
land every day; monthly is plenty for Fiji.

## 6. Try it without a server

The same stack runs locally: `docker compose --profile maps up -d --build`, then
open `https://localhost` (Caddy uses a local CA for `localhost`). Or run the API
directly (`npm run api`) with `OSRM_URL`/`NOMINATIM_URL` unset — routing and
geocoding fall back to a straight line and a "Dropped pin" label.

## 7. Building elsewhere (small VM, or building on a laptop)

`expo export` needs ~2 GB of RAM. If the VM has less, build the image somewhere
else and let the VM pull it.

> **Match the architecture.** Oracle Ampere is **arm64**. An image built on a
> normal amd64 laptop fails on the VM with `exec format error`. Ask buildx for
> `linux/arm64` explicitly, or build on an arm64 machine.

### Option A — GitHub Actions (free for public repos)

`.github/workflows/publish.yml` builds `linux/arm64` natively on an arm64 runner
and pushes to GHCR on every push to `main`.

**Once**, make the package public so the VM can pull it with no credentials. It is
not under a "Packages" tab named after the app — GitHub names the package after the
**repo**:

1. Open the package page: the repo's right-hand sidebar → **Packages**, or
   `https://github.com/<you>/<repo>/pkgs/container/<repo>` (for this copy,
   `https://github.com/fijirealmproperties-star/pointbreak-rides-fiji/pkgs/container/pointbreak-rides-fiji`).
2. **Package settings** → **Danger zone** → **Change visibility** → **Public**, and
   type the package name to confirm.

That page is instructions, not a command — pasting the comments into a shell does
nothing. Prove it from a machine with no GitHub credentials:

```bash
docker logout ghcr.io 2>/dev/null || true
docker pull ghcr.io/<you>/<repo>:latest
```

`unauthorized` or `denied` means the package is still private, or the owner in the
image path is not the owner of the package. Keeping it private is fine too, but
then `docker login ghcr.io -u <you> -p <PAT with read:packages>` on the VM — and
note that `sudo docker` does not see that login, and the credential it stores in
`~/.docker/config.json` is base64, not encrypted.

Nothing else to do; `latest` is updated by CI. The image name is the repository
name in lowercase — `ghcr.io/<you>/<repo>:latest`, i.e.
`ghcr.io/fijirealmproperties-star/pointbreak-rides-fiji:latest` for this copy —
not the `pointbreak` name used in the examples below. If arm64 runners are not
available to you (private repo), change `runs-on` to `ubuntu-latest` and
`platforms` to `linux/amd64,linux/arm64` — slower, because amd64 builds the arm
image under emulation.

### Option B — build locally with buildx

```bash
echo "$CR_PAT" | docker login ghcr.io -u <you> --password-stdin   # PAT: write:packages
docker buildx build --platform linux/arm64 \
  -t ghcr.io/<you>/pointbreak-rides-fiji:latest --push .
```

GHCR package names must be lowercase. `--push` is required here: a foreign-arch
image cannot be loaded into your local Docker. Make the package public (see
above), or run `docker login ghcr.io` on the VM as well.

### On the VM: run the published image

Do not edit `docker-compose.yml` — it is tracked, so the next `git pull` (§5)
would refuse to overwrite the change. Compose merges a file named
`docker-compose.override.yml` automatically, and that one lives only on the VM:

```bash
cat > docker-compose.override.yml <<'EOF'
services:
  pointbreak-api:
    image: ghcr.io/<you>/pointbreak-rides-fiji:latest
EOF
```

Then:

```bash
docker compose pull pointbreak-api
docker compose --profile maps up -d --no-build
```

Prove what is actually running — the image is labelled with the commit it was
built from:

```bash
docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  "$(docker compose ps -q pointbreak-api)"     # e.g. 35d29c4ad6b4d27ac78074588e9a0a21108a40fc
git log --oneline -1
```

`latest` is only whatever CI finished last, and CI takes a couple of minutes, so
pulling straight after a push can quietly give you the previous build. The label
tells you which commit is actually being served. Doc-only commits never rebuild it
— the workflow triggers on `Dockerfile`, `.dockerignore`, `server/`, `web/`,
`mobile/` and `package.json` — so the label can legitimately lag `HEAD`; a lagging
*code* commit is the thing to notice. Pinning `:sha-<commit>` removes the guesswork.

This image is `linux/arm64` only (it is built on a native arm64 runner). On an
amd64 host — the 2× micro from §1 — `pull` stops with `no matching manifest for
linux/amd64`; that box must build its own (§5) or publish both architectures.

`pull access denied` for a name shaped like `pointbreak-pointbreak-api` — the
name Compose would give a local build, rather than `ghcr.io/...` — means the
override file above is missing or was written in a different directory.
`docker compose config | grep 'image:'` shows what each service will really pull.

`docker image prune -f` afterwards clears the image this pull replaced.

Use `--no-build` from then on (§5 included). A stray `--build` would try to build
on the VM again, which is exactly what this section avoids. To update, pull and
`up -d` again.

## 8. What is still not free (and how to avoid it)

| Item | Cost | Free alternative |
| --- | --- | --- |
| Google Play listing | US$25 once | Ship the PWA |
| Apple App Store | US$99/yr | Ship the PWA |
| Custom domain | ~US$10–20/yr | DuckDNS / sslip.io |
| SMS login | varies | Already phone + password (no SMS) |
| Paid map APIs | $/month | This setup |

## 9. Distribution — no app store needed

The container that serves the API also serves an installable web app, so there
is nothing to buy, submit, or wait for approval on.

### The install page (recommended)

`https://<SITE_DOMAIN>/download` is a plain HTML page
(`mobile/public/download/index.html`) that offers:

- **Install now** — the browser's native install prompt (Chrome/Edge on Android
  and desktop).
- **Add to Home Screen** steps for iOS/Safari, detected from the user agent.
- An **APK** button that stays disabled until an APK is actually published.

It is wired in automatically: `npm run export` runs `mobile/scripts/pwa.js`
after `expo export`, which copies `mobile/public/` (manifest, service worker,
icons, download page) into the build and injects the manifest + service-worker
tags into `index.html`. The Docker build runs the same command, so every deploy
already ships it.

What users get: a home-screen icon, standalone window (no browser chrome), an
offline app shell, and updates on next launch. No store account, no review, no
commission.

### Optional: signed APK for sideloading

Only needed if you want a file to hand out, or for devices without Chrome.
One-time setup:

```bash
cd mobile
npm i -g eas-cli          # or prefix each command with npx
eas login
# set the real origin in eas.json -> build.download.env.EXPO_PUBLIC_API_URL
eas build -p android --profile download     # cloud (free tier) or add --local
```

`EXPO_PUBLIC_DEMO=false` is already set in that profile, so the demo logins are
hidden. The build fails immediately if the API URL is still the `CHANGE-ME`
placeholder, instead of shipping an app that points at nowhere.

Publish the APK. The page probes exactly `/downloads/pointbreak.apk`, so the
filename matters:

```bash
# cloud build: EAS prints an artifact URL (the build page has a download button);
# `eas build --local` instead leaves build-<timestamp>.apk in mobile/.
curl -L -o pointbreak.apk "<artifact URL>"
scp pointbreak.apk you@vm:pointbreak/downloads/pointbreak.apk
```

The remote path is relative to the login user's home, i.e. the `pointbreak` clone
from §3 — adjust it if you cloned somewhere else.

`downloads/` is in the repo (kept by `.gitkeep`) and Compose mounts it read-only
into the web root, so the button on `/download` becomes **Download APK** on the
next page load — no rebuild, no restart. If Docker created that directory as root
on an older checkout, `sudo chown -R "$USER" downloads` once.

Check it:

```bash
curl -sI https://<SITE_DOMAIN>/downloads/pointbreak.apk | head -n 3
# HTTP/2 200
# content-type: application/vnd.android.package-archive
# content-length: <bytes>
```

A 404 whose body is `text/html` means the file is not where Compose looks —
copied into `mobile/dist/downloads/` (the direct-run location) instead of
`downloads/`, or the name is not exactly `pointbreak.apk`.

APKs do not self-update: replace the file and bump `version` in
`mobile/app.config.js` when you ship a new one. Android installs it over the old
app as long as it is signed with the same key (EAS keeps that key for you).

## Notes

- Attribution is required by the ODbL: keep the OpenStreetMap credit that
  OpenFreeMap's style renders, and Nominatim's data credit in the app.
- Nominatim is for this app only. Don't expose it as a public geocoder.
- `NOMINATIM_PASSWORD` in `.env` only protects the internal Postgres user; it
  is never reachable from outside the Docker network.
