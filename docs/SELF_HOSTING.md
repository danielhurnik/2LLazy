# Self-hosting 2LLazy

Everything runs on hardware you control: no hosting provider in the loop, no
managed database, nothing to sign up for.

Three moving parts: **PostgreSQL**, the **web app** (a long-lived server on
`PORT`, default 3000), and the **job ingester** (`scripts/ingest.ts`, a batch
job that runs for minutes, a few times a day). The ingester is deliberately not
part of the web process: a polite multi-board crawl takes minutes and a web
request has to answer in seconds. It writes into Postgres on its own schedule,
and the app answers searches out of the database — which is why a search is
instant.

Two ways to install: [Docker](#the-docker-path) (one command, everything
included) or [bare metal](#the-bare-metal-path) (Node and PostgreSQL you manage
yourself). Both end at the same place: a reverse proxy in front, TLS from Let's
Encrypt, and the ingester on a timer.

## What you need

- **A server.** 1 vCPU and 2 GB of RAM is comfortable. Building is the
  memory-hungry step — on 1 GB, add swap or
  [build elsewhere](#the-build-runs-out-of-memory).
- **A domain**, with an `A` record (and `AAAA` if you have IPv6) pointing at
  the server, and ports 80 and 443 reachable.
- **Either** Docker Engine 24+ with the Compose plugin, **or** Node.js 20.9+
  and PostgreSQL 14+ (16 is what this is tested against).

## Configuration

Everything is environment variables. `docs/CONFIGURATION.md` documents them all;
this is the subset that matters on a server.

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | Signs session cookies. Any long random string |
| `AUTH_URL` | behind a proxy | The public origin, e.g. `https://jobs.example.com` |
| `DEFAULT_COUNTRY` | no | Fallback country, ISO 3166-1 alpha-2 |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | no | Adzuna's free tier: local boards in ~19 countries |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Google sign-in and calendar sync |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | no | Same client id, **compiled into the browser bundle at build time** |

`AUTH_URL` is the one that catches people. Auth.js will not trust a `Host` header
forwarded by a proxy unless you tell it the real origin; without it, production
sign-in fails with `UntrustedHost`. Set it to the URL people type, scheme and
all. Generate `AUTH_SECRET` with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## The Docker path

Everything — database, schema, app — comes up together. The `Dockerfile` has two
final stages (the web app, and a worker image for migrations and ingestion) and
`docker-compose.yml` wires them to PostgreSQL.

### 1. Get the code and write `.env`

Compose reads `.env` from the project directory. `.gitignore` excludes `.env*`,
so it is never committed.

```bash
sudo git clone https://github.com/danielhurnik/2llazy.git /opt/2llazy
cd /opt/2llazy
```

```bash
PGPASS=$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")

cat > .env <<EOF
# Stock postgres:16-alpine has no pgvector, and one old migration still creates
# that extension. This image is the same PostgreSQL with pgvector available, so
# the migration history applies as written. See "Migrations fail on the vector
# extension" below for the alternative.
POSTGRES_IMAGE=pgvector/pgvector:pg16
POSTGRES_USER=twollazy
POSTGRES_PASSWORD=$PGPASS
POSTGRES_DB=twollazy

# The host is db — the service name on the compose network, not localhost.
DATABASE_URL=postgresql://twollazy:$PGPASS@db:5432/twollazy?schema=public

AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
AUTH_URL=https://jobs.example.com
DEFAULT_COUNTRY=CZ
TZ=Europe/Prague
EOF
chmod 600 .env
```

Replace `jobs.example.com` with your domain. Without `node` on the server,
generate the two secrets elsewhere and paste them in.

### 2. Start it

```bash
docker compose up -d --build
```

The first build takes a few minutes. Compose starts `db` and waits for
`pg_isready`; runs `migrate` to completion (`prisma migrate deploy`, then
`scripts/apply-search-indexes.ts`, which adds the two expression indexes behind
lexical search that Prisma's schema language cannot describe); then starts
`app` on `127.0.0.1:3000` — loopback only, because a reverse proxy goes in
front of it. Watch it settle:

```bash
docker compose ps          # app should reach "healthy" within a minute
docker compose logs -f app
curl -I http://127.0.0.1:3000/login
```

`migrate` runs on every `docker compose up`; both its steps are idempotent, so
after the first time it costs a second and does nothing.

### 3. Create the first account

There is no self-service sign-up. Either sign in with Google (which creates the
account on first login, if you set the OAuth variables), or insert one:

```bash
docker compose run --rm --entrypoint node ingest -e '
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const bcrypt = require("bcryptjs");
const [email, password] = process.argv.slice(1);
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const hash = bcrypt.hashSync(password, 12);
prisma.user
  .upsert({ where: { email }, update: { password: hash }, create: { email, name: email.split("@")[0], password: hash } })
  .then((u) => console.log("account ready:", u.email))
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
' you@example.com 'a-long-password-you-chose'
```

Run it again with a different password to reset one.

### 4. Collect some jobs

The database starts empty, so the first search finds nothing. Fill it, then put
it on a schedule — see [Scheduling the ingester](#scheduling-the-ingester).

```bash
docker compose run --rm ingest --country CZ
```

## The bare-metal path

No Docker: Node runs the app under systemd, PostgreSQL is a package.

### 1. PostgreSQL

Create the role and database, giving the connection string
`postgresql://twollazy:THE_PASSWORD@localhost:5432/twollazy?schema=public`:

```bash
sudo apt install postgresql
sudo -u postgres createuser --pwprompt twollazy
sudo -u postgres createdb --owner=twollazy twollazy
```

### 2. The app

```bash
sudo git clone https://github.com/danielhurnik/2llazy.git /opt/2llazy
sudo adduser --system --group --home /opt/2llazy --no-create-home 2llazy
sudo chown -R 2llazy:2llazy /opt/2llazy
cd /opt/2llazy

# -H so npm's cache lands in the service user's home, not root's.
sudo -H -u 2llazy npm ci       # full install: the build needs devDependencies
sudo -H -u 2llazy npx prisma generate
sudo -H -u 2llazy npm run build
```

Keep the environment out of the repository, in `/etc/2llazy/app.env` — owned by
root, mode 0640, group-readable by the service user:

```ini
DATABASE_URL=postgresql://twollazy:THE_PASSWORD@localhost:5432/twollazy?schema=public
AUTH_SECRET=...
AUTH_URL=https://jobs.example.com
NODE_ENV=production
```

The ingester reads the same variables: either point both units at this file, or
copy `DATABASE_URL` into `/etc/2llazy/ingest.env`.

### 3. Schema

`set -a` exports what the file defines, so the commands inherit `DATABASE_URL`:

```bash
cd /opt/2llazy
sudo -H -u 2llazy sh -c 'set -a; . /etc/2llazy/app.env; set +a
  npx prisma migrate deploy
  npx tsx scripts/apply-search-indexes.ts'
```

If `migrate deploy` fails on the `vector` extension, see
[the troubleshooting entry](#migrations-fail-on-the-vector-extension).

### 4. systemd

`/etc/systemd/system/2llazy.service`:

```ini
[Unit]
Description=2LLazy web app
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=2llazy
Group=2llazy
WorkingDirectory=/opt/2llazy
EnvironmentFile=/etc/2llazy/app.env
ExecStart=/opt/2llazy/node_modules/.bin/next start --port 3000 --hostname 127.0.0.1
Restart=on-failure
RestartSec=5s

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/2llazy/.next -/opt/2llazy/uploads

[Install]
WantedBy=multi-user.target
```

It binds to loopback, because the reverse proxy is the only thing that should
reach it. `.next` and `uploads` stay writable under `ProtectSystem=strict` —
several pages revalidate on a timer and cache the result, and CV uploads land on
disk. `uploads` is not in the repository, so create it first:

```bash
sudo -u 2llazy mkdir -p /opt/2llazy/uploads
sudo systemctl daemon-reload && sudo systemctl enable --now 2llazy
journalctl -u 2llazy -f
```

Create the first account with the script from step 3 of the Docker path, run
from `/opt/2llazy` as `node -e '…' you@example.com 'password'` with
`DATABASE_URL` exported — no container wrapper.

## Reverse proxy and TLS

The app speaks plain HTTP on loopback; something in front terminates TLS. Caddy
is the shortest path — it obtains and renews a Let's Encrypt certificate itself,
with no certbot and no renewal cron.

```bash
sudo apt install caddy
sudo cp /opt/2llazy/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/jobs.example.com/YOUR.DOMAIN/' /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

`deploy/Caddyfile` is a working config: HTTPS, compression, a request-body cap
matching the app's 10 MB upload limit, and `flush_interval -1` so the SSE routes
(`/api/scrape` and the two `/api/*/stream` routes) stream progress instead of
arriving in one lump. Make sure `AUTH_URL` matches the hostname in it.

**nginx works too**, with certbot for the certificate. `proxy_buffering off` is
not optional — without it the live search results arrive in one lump at the end:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    client_max_body_size 12m;
}
```

## Scheduling the ingester

The ingester is a batch job. Run it **a few times a day, not continuously**: it
is incremental, so a repeat run only fetches what the board says has changed,
and hourly costs the boards bandwidth for almost nothing. Two rules:

- **It is safe to run beside the web app.** Different process, same database;
  searches keep working while a crawl is in progress.
- **It is not safe to run beside itself.** Two copies contend on the same rows
  and crawl every board twice. One country per invocation — that is what
  `--country` is for — and countries one after another, because the worldwide
  boards (Remotive, RemoteOK and friends) are shared between them.

The flags that matter for a scheduled run — `npx tsx scripts/ingest.ts --help`
lists them all: `--country <ISO>`, `--limit <n>`, `--full` (ignore the last-run
timestamp, walk everything) and `--dry-run` (scrape, write nothing).

A run exits non-zero only if *every* board failed. Partial failure is normal —
boards change their markup — and is reported per board in the summary table.

### systemd timer (preferred)

`deploy/2llazy-ingest.service` and `deploy/2llazy-ingest.timer` are ready to
install — edit the countries on the `ExecStart` lines and the paths first.

```bash
sudo cp /opt/2llazy/deploy/2llazy-ingest.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now 2llazy-ingest.timer

systemctl list-timers 2llazy-ingest.timer   # when it next fires
sudo systemctl start 2llazy-ingest.service  # run one now
journalctl -u 2llazy-ingest.service -f
```

It fires at 05:20, 13:20 and 21:20 with `RandomizedDelaySec=45m`, so the crawl
does not arrive on the same second every day — boards notice that.
`Persistent=true` catches up one missed run after the machine was off. And because
the unit is `Type=oneshot`, systemd will not start a second copy while one is
still running: an overrunning crawl absorbs the next trigger.

### cron

`deploy/crontab.example` has both a Docker and a bare-metal line — pick one and
delete the other:

```bash
sudo cp /opt/2llazy/deploy/crontab.example /etc/cron.d/2llazy
sudo chmod 0644 /etc/cron.d/2llazy
sudo install -d -o 2llazy -g 2llazy /var/log/2llazy   # cron writes the log here
```

Cron has no equivalent of systemd's "do not start it twice", so the example wraps
the run in `flock`. Keep that.

### Docker

The `ingest` service sits behind a compose profile, so `docker compose up`
never starts a crawl. Invoke it directly, appending flags:

```bash
docker compose run --rm ingest --country CZ
docker compose run --rm ingest --country DE --limit 200
docker compose run --rm ingest --country BR --dry-run
```

Schedule that with the Docker line in `deploy/crontab.example`, or a systemd
timer whose `ExecStart` is `/usr/bin/docker compose -f
/opt/2llazy/docker-compose.yml run --rm ingest --country CZ`.

## Backups

Everything that matters is in PostgreSQL: your account, applications, interviews,
CV documents, and the collected postings. Only the postings are replaceable, by
another crawl. Dump in the custom format, so `pg_restore` can be selective:

```bash
docker compose exec -T db pg_dump -U twollazy -Fc twollazy > 2llazy-$(date +%F).dump
sudo -u postgres pg_dump -Fc twollazy > 2llazy-$(date +%F).dump   # bare metal
```

Nightly, as `/etc/cron.d/2llazy-backup` — the escaped `%` is not a typo, cron
treats a bare one as a newline:

```
30 3 * * *  root  cd /opt/2llazy && docker compose exec -T db pg_dump -U twollazy -Fc twollazy > /var/backups/2llazy-$(date +\%F).dump && find /var/backups -name '2llazy-*.dump' -mtime +14 -delete
```

Restore into an empty database — stop the app first, since `dropdb` refuses
while anything is connected. `-U twollazy` is `POSTGRES_USER` from your `.env`:

```bash
# Docker
docker compose stop app
docker compose exec -T db dropdb   -U twollazy --if-exists twollazy
docker compose exec -T db createdb -U twollazy twollazy
docker compose exec -T db pg_restore -U twollazy -d twollazy --no-owner < 2llazy-2026-08-24.dump
docker compose up -d

# Bare metal
sudo systemctl stop 2llazy
sudo -u postgres pg_restore -d twollazy --clean --no-owner 2llazy-2026-08-24.dump
sudo systemctl start 2llazy
```

Uploaded CV files also live on disk — the `app-uploads` Docker volume, or
`/opt/2llazy/uploads` — so copy that alongside the dump if you use uploads.

## Upgrading

```bash
cd /opt/2llazy

# Docker — rebuilds, re-runs migrations, restarts
sudo git pull && docker compose up -d --build

# Bare metal — as the service user, so nothing ends up owned by root
sudo -H -u 2llazy sh -c 'set -a; . /etc/2llazy/app.env; set +a
  git pull
  npm ci
  npx prisma generate
  npm run build
  npx prisma migrate deploy'
sudo systemctl restart 2llazy
```

Take a backup first: migrations run forward only, there is no down-migration.
`docker image prune -f` reclaims the disk the old images used.

## Troubleshooting

### The app cannot reach Postgres

`Can't reach database server` in the app log, or a 500 on every page.

- **In Docker**, the host must be `db`, the compose service name — inside the
  app container, `localhost` is the app container. Check what it actually got:
  `docker compose exec app printenv DATABASE_URL`.
- **On bare metal** it is the opposite: `localhost` is right.
  `psql "$DATABASE_URL" -c 'select 1'` proves both the server and credentials.
- `docker compose ps db` should say `healthy`. If it is restarting,
  `docker compose logs db` says why — usually a data directory left from a
  different major version.
- A password containing `@`, `:` or `/` must be percent-encoded in the URL.

### Migrations fail on the `vector` extension

`ERROR: extension "vector" is not available`. The migration history predates the
rewrite, and one early migration still runs `CREATE EXTENSION IF NOT EXISTS
vector`. Nothing uses vectors any more, but `prisma migrate deploy` replays
history as written, so a PostgreSQL without pgvector stops there. Two ways out.

**Give it pgvector**, keeping the migration history intact — what the `.env`
above does:

```bash
echo 'POSTGRES_IMAGE=pgvector/pgvector:pg16' >> .env
docker compose up -d
```

**Or skip the history**: `prisma db push` builds the current schema directly,
and the indexes are added separately because `db push` cannot create expression
indexes. The trade-off is that the database then has no migration history, so
`migrate deploy` will refuse it and you stay on `db push` — the same escape
hatch the README describes for local development.

```bash
# Docker
docker compose run --rm db-push

# Bare metal
npx prisma db push
npm run db:indexes
```

### The ingester finds no jobs

`0 postings collected` is a real result, not always a bug. Work through it in
this order:

- **It is incremental.** A second run minutes after the first legitimately
  finds nothing: boards report nothing changed, and postings stored within the
  last 12 hours are skipped. `--full` ignores the last-run timestamp and walks
  everything.
- **Try `--dry-run`**, which scrapes without writing. If that finds postings,
  the problem is the database write, not the crawl.
- **Check the country has boards.**
  `npx tsx scripts/scrape.ts --list --country CZ` prints which apply and which
  are skipped. An empty list means the country code is wrong — it is ISO
  3166-1 alpha-2, uppercase.
- **Read the per-board table** every run prints. `ERROR:` against all of them
  points at the network: no outbound HTTPS, or DNS that does not resolve. One
  or two failing is normal, since boards change their markup.
- **Some boards are skipped by design.** Boards needing a browser are off (the
  image ships none, and ingestion reaches them through sitemaps instead), and
  Adzuna is off without `ADZUNA_APP_ID` / `ADZUNA_APP_KEY`.

### Sign-in fails with `UntrustedHost`

`AUTH_URL` is unset or does not match the hostname the browser used. Set it to
the exact public origin, `https://` included, and restart the app.
`AUTH_TRUST_HOST=true` also works, but `AUTH_URL` also fixes OAuth callbacks.
If Google sign-in specifically fails, the redirect URI registered in the Google
console must be `https://YOUR.DOMAIN/api/auth/callback/google`.

### The build runs out of memory

`next build` is the heaviest thing that happens on the server, and on a 1 GB box
the OOM reaper can kill it mid-build — which looks like the build simply
stopping, with no error. Add swap, or build the image on a bigger machine and
pull it from a registry you control:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

### The app is up but the domain shows nothing

The app listens on `127.0.0.1:3000` on purpose: only the proxy reaches it. If
`curl -I http://127.0.0.1:3000/login` works on the server but the domain does
not, the problem is Caddy or DNS — `sudo journalctl -u caddy -n 50`.
