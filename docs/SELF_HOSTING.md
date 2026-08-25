# Self-hosting 2LLazy

Everything runs on hardware you control. There is no hosting provider in the
loop, no managed database, and nothing to sign up for.

Three moving parts:

| Part | Shape | Lives for |
|---|---|---|
| PostgreSQL | server | forever |
| The web app | server, listens on `PORT` (default 3000) | forever |
| The job ingester | batch job, `scripts/ingest.ts` | minutes, a few times a day |

The ingester is deliberately not part of the web process. A polite multi-board
crawl takes minutes; a web request has to answer in seconds. So the crawl runs
on its own schedule, writes into Postgres, and the app answers searches out of
the database — which is why a search is instant.

Two ways to install: [Docker](#the-docker-path) (one command, everything
included) or [bare metal](#the-bare-metal-path) (Node and PostgreSQL you
manage yourself). Both end at the same place: a reverse proxy in front, TLS
from Let's Encrypt, and the ingester on a timer.

## What you need

- **A server.** 1 vCPU and 2 GB of RAM runs the app comfortably. Building the
  image is the memory-hungry step — on 1 GB, add swap or
  [build elsewhere](#the-build-runs-out-of-memory).
- **A domain**, with an `A` record (and `AAAA` if you have IPv6) pointing at
  the server, and ports 80 and 443 reachable.
- **Either** Docker Engine 24+ with the Compose plugin, **or** Node.js 20.9+
  and PostgreSQL 14+ (16 is what this is tested against).

That is the list. No API keys, no accounts, no paid tier — the app uses no AI
service and no commercial API in its default path.

## Configuration

Everything is environment variables. `docs/CONFIGURATION.md` documents all of
them; this is the subset that matters on a server.

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `AUTH_SECRET` | yes | Signs session cookies. Any long random string |
| `AUTH_URL` | behind a proxy | The public origin, e.g. `https://jobs.example.com` |
| `DEFAULT_COUNTRY` | no | Fallback country, ISO 3166-1 alpha-2 |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | no | Adzuna's free tier: local boards in ~19 countries |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Google sign-in and calendar sync |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | no | Same client id, **compiled into the browser bundle at build time** |

`AUTH_URL` is the one that catches people. Auth.js will not trust a `Host`
header forwarded by a proxy unless you tell it the real origin; without it,
production sign-in fails with `UntrustedHost`. Set it to the URL people type,
scheme and all.

Generate the secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`NEXT_PUBLIC_GOOGLE_CLIENT_ID` is inlined into JavaScript the browser
downloads, so it is fixed when the app is built. Changing it means rebuilding.

## The Docker path

Everything — database, schema, app — comes up together. The repository ships a
`Dockerfile` (two final stages: the web app, and a worker image for migrations
and ingestion) and a `docker-compose.yml` that wires them to PostgreSQL.

### 1. Get the code

```bash
sudo git clone https://github.com/danielhurnik/2llazy.git /opt/2llazy
cd /opt/2llazy
```

### 2. Write `.env`

Compose reads `.env` from the same directory. `.gitignore` excludes `.env*`, so
it will never be committed.

```bash
cat > .env <<EOF
# --- Database ---------------------------------------------------------------
# Stock postgres:16-alpine has no pgvector, and one old migration in this
# repository still creates that extension. This image is the same PostgreSQL
# with pgvector available, which lets the migration history apply as written.
# See "Migrations fail on the vector extension" below for the alternative.
POSTGRES_IMAGE=pgvector/pgvector:pg16
POSTGRES_USER=twollazy
POSTGRES_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))")
POSTGRES_DB=twollazy

# --- App --------------------------------------------------------------------
AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
AUTH_URL=https://jobs.example.com
DEFAULT_COUNTRY=CZ
TZ=Europe/Prague
EOF
chmod 600 .env
```

Then set `DATABASE_URL` to match the database credentials you just generated —
the host is `db`, the service name on the compose network:

```bash
echo "DATABASE_URL=postgresql://twollazy:$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)@db:5432/twollazy?schema=public" >> .env
```

Replace `jobs.example.com` with your domain. If `node` is not installed on the
server, generate the two secrets anywhere else and paste them in.

### 3. Start it

```bash
docker compose up -d --build
```

The first build takes a few minutes. In order, compose will:

1. start `db` and wait until `pg_isready` says it is accepting connections;
2. run `migrate` to completion — `prisma migrate deploy`, then
   `scripts/apply-search-indexes.ts`, which adds the two expression indexes
   behind lexical search that Prisma's schema language cannot describe;
3. start `app`, published on `127.0.0.1:3000` — loopback only, because a
   reverse proxy will sit in front of it.

Watch it settle:

```bash
docker compose ps          # app should reach "healthy" within a minute
docker compose logs -f app
curl -I http://127.0.0.1:3000/login
```

`migrate` runs on every `docker compose up`. Both of its steps are idempotent,
so after the first time it costs a second and does nothing.

### 4. Create the first account

There is no self-service sign-up. Either sign in with Google (the account is
created on first login, if you configured the OAuth variables), or insert a
credentials account directly:

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

### 5. Collect some jobs

The database starts empty, so the first search finds nothing. Fill it:

```bash
docker compose run --rm ingest --country CZ
```

Then set it up to run on a schedule — see
[Scheduling the ingester](#scheduling-the-ingester).

## The bare-metal path

No Docker. Node runs the app under systemd, PostgreSQL is a package.

### 1. PostgreSQL

```bash
sudo apt install postgresql
sudo -u postgres createuser --pwprompt twollazy
sudo -u postgres createdb --owner=twollazy twollazy
```

The connection string is then
`postgresql://twollazy:THE_PASSWORD@localhost:5432/twollazy?schema=public`.

### 2. The app

```bash
sudo adduser --system --group --home /opt/2llazy 2llazy
sudo git clone https://github.com/danielhurnik/2llazy.git /opt/2llazy
sudo chown -R 2llazy:2llazy /opt/2llazy
cd /opt/2llazy

sudo -u 2llazy npm ci          # full install: the build needs devDependencies
sudo -u 2llazy npx prisma generate
sudo -u 2llazy npm run build
```

Keep the environment out of the repository:

```bash
sudo install -d -m 0750 -o root -g 2llazy /etc/2llazy
sudo install -m 0640 -o root -g 2llazy /dev/null /etc/2llazy/app.env
sudo -e /etc/2llazy/app.env
```

```ini
DATABASE_URL=postgresql://twollazy:THE_PASSWORD@localhost:5432/twollazy?schema=public
AUTH_SECRET=...
AUTH_URL=https://jobs.example.com
NODE_ENV=production
PORT=3000
HOSTNAME=127.0.0.1
```

The ingester reads the same variables, so either point both units at this file
or copy `DATABASE_URL` into `/etc/2llazy/ingest.env`.

### 3. Schema

```bash
cd /opt/2llazy
sudo -u 2llazy env $(cat /etc/2llazy/app.env | xargs) npx prisma migrate deploy
sudo -u 2llazy env $(cat /etc/2llazy/app.env | xargs) npx tsx scripts/apply-search-indexes.ts
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
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start
Restart=on-failure
RestartSec=5s

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/2llazy/.next /opt/2llazy/uploads

[Install]
WantedBy=multi-user.target
```

`.next` and `uploads` are writable because several pages revalidate on a timer
and cache the result, and CV uploads land on disk.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now 2llazy
journalctl -u 2llazy -f
```

Create the first account the same way as the Docker path, without the
container wrapper:

```bash
cd /opt/2llazy
sudo -u 2llazy env $(cat /etc/2llazy/app.env | xargs) node -e '...same script as above...' \
  you@example.com 'a-long-password-you-chose'
```

## Reverse proxy and TLS

The app speaks plain HTTP on loopback. Something in front of it terminates TLS
and forwards. Caddy is the shortest path: it obtains and renews a Let's Encrypt
certificate by itself, with no certbot and no renewal cron.

```bash
sudo apt install caddy
sudo cp /opt/2llazy/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/jobs.example.com/YOUR.DOMAIN/' /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

`deploy/Caddyfile` is a working config: HTTPS, compression, a request-body cap
matching the app's 10 MB upload limit, and `flush_interval -1` so the
server-sent-event routes (`/api/scrape` and the two `/api/*/stream` routes)
stream progress instead of arriving in one lump at the end.

Make sure `AUTH_URL` in `.env` (or `/etc/2llazy/app.env`) matches the hostname
in the Caddyfile, then restart the app.

**nginx works too.** Two settings are not optional:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;   # or the live search results arrive all at once
    client_max_body_size 12m;
}
```

With nginx you also run certbot yourself.

## Scheduling the ingester

The ingester is a batch job. Run it **a few times a day, not continuously**: it
is incremental, so a repeat run only fetches postings the board says have
changed since last time. Running it hourly costs the boards bandwidth and gains
you almost nothing.

Two rules:

- **It is safe to run beside the web app.** Different process, same database.
  Searches keep working while a crawl is in progress.
- **It is not safe to run beside itself.** Two copies contend on the same rows
  and crawl every board twice. Run one country per invocation — that is what
  `--country` is for — and run the countries one after another, because the
  worldwide boards (Remotive, RemoteOK and friends) are shared between them.

```
npx tsx scripts/ingest.ts --help

  -c, --country <ISO>     Country to collect for (default: $DEFAULT_COUNTRY or US)
  -b, --boards <ids>      Comma-separated board ids (default: every board for the country)
  -q, --queries <list>    Seed queries for search-only boards
      --limit <n>         Max postings per board (default 400)
      --concurrency <n>   Requests in flight across all hosts (default 4)
      --full              Ignore the last-run timestamp; walk everything
      --dry-run           Scrape but write nothing
      --quiet             Only print the final summary
```

A run exits non-zero only if *every* board failed. Partial failure is normal —
boards change their markup — and is reported per board in the summary table.

### systemd timer (preferred)

`deploy/2llazy-ingest.service` and `deploy/2llazy-ingest.timer` are ready to
install. Edit the countries on the `ExecStart` lines and the paths first.

```bash
sudo cp /opt/2llazy/deploy/2llazy-ingest.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now 2llazy-ingest.timer

systemctl list-timers 2llazy-ingest.timer   # when it next fires
sudo systemctl start 2llazy-ingest.service  # run one now
journalctl -u 2llazy-ingest.service -f
```

The timer fires at 05:20, 13:20 and 21:20 with `RandomizedDelaySec=45m`, so the
crawl does not arrive on the same second every day — boards notice that.
`Persistent=true` catches up one missed run after the machine was off. Because
the unit is `Type=oneshot`, systemd will not start a second copy while one is
still running: an overrunning crawl absorbs the next trigger.

### cron

`deploy/crontab.example` has both a Docker and a bare-metal line. Pick one:

```bash
sudo cp /opt/2llazy/deploy/crontab.example /etc/cron.d/2llazy
sudo chmod 0644 /etc/cron.d/2llazy
sudo install -d -o 2llazy -g 2llazy /var/log/2llazy
```

Cron has no equivalent of systemd's "don't start it twice", so the example
wraps the run in `flock`. Keep that.

### Docker

The `ingest` service sits behind a compose profile, so `docker compose up`
never starts a crawl. Invoke it directly, appending flags:

```bash
docker compose run --rm ingest --country CZ
docker compose run --rm ingest --country DE --limit 200
docker compose run --rm ingest --country BR --dry-run
```

Schedule that same command with the Docker line in `deploy/crontab.example`,
or with a systemd timer whose `ExecStart` is
`/usr/bin/docker compose -f /opt/2llazy/docker-compose.yml run --rm ingest --country CZ`.

## Backups

Everything that matters is in PostgreSQL: your account, applications,
interviews, CV documents, and the collected postings. The postings are
replaceable — another crawl regenerates them — but the rest is not.

Dump, in the custom format so `pg_restore` can be selective:

```bash
# Docker
docker compose exec -T db pg_dump -U twollazy -Fc twollazy > 2llazy-$(date +%F).dump

# Bare metal
sudo -u postgres pg_dump -Fc twollazy > 2llazy-$(date +%F).dump
```

Nightly, as `/etc/cron.d/2llazy-backup`:

```
30 3 * * *  root  cd /opt/2llazy && docker compose exec -T db pg_dump -U twollazy -Fc twollazy > /var/backups/2llazy-$(date +\%F).dump && find /var/backups -name '2llazy-*.dump' -mtime +14 -delete
```

The `%` needs escaping in a crontab; that is not a typo.

Restore into an empty database:

```bash
# Docker
docker compose up -d db
docker compose exec -T db dropdb   -U twollazy --if-exists twollazy
docker compose exec -T db createdb -U twollazy twollazy
docker compose exec -T db pg_restore -U twollazy -d twollazy --no-owner < 2llazy-2026-08-24.dump
docker compose up -d

# Bare metal
sudo -u postgres pg_restore -d twollazy --clean --no-owner 2llazy-2026-08-24.dump
```

Uploaded CV files also live on disk — in the `app-uploads` Docker volume, or in
`/opt/2llazy/uploads` on bare metal. Copy that directory alongside the dump if
you use the upload route.

## Upgrading

```bash
cd /opt/2llazy
git pull

# Docker
docker compose up -d --build          # rebuilds, re-runs migrations, restarts

# Bare metal
sudo -u 2llazy npm ci
sudo -u 2llazy npx prisma generate
sudo -u 2llazy npm run build
sudo -u 2llazy env $(cat /etc/2llazy/app.env | xargs) npx prisma migrate deploy
sudo systemctl restart 2llazy
```

Take a backup first. Migrations run forward only; there is no down-migration.

To free the disk the old images used: `docker image prune -f`.

## Troubleshooting

### The app cannot reach Postgres

The symptom is `Can't reach database server` in the app log, or a 500 on every
page.

- **In Docker**, the host in `DATABASE_URL` must be `db` — the compose service
  name — not `localhost`. Inside the app container, `localhost` is the app
  container. Check what the app actually received:
  `docker compose exec app printenv DATABASE_URL`.
- **On bare metal** it is the opposite: `localhost` is right, and PostgreSQL
  must be listening. `sudo -u postgres psql -c 'select 1'` proves the server is
  up; `psql "$DATABASE_URL" -c 'select 1'` proves the credentials work.
- Check the database is healthy at all: `docker compose ps db` should say
  `healthy`. If it is restarting, `docker compose logs db` says why — usually a
  data directory left over from a different major version.
- A password with `@`, `:` or `/` in it must be percent-encoded in the URL.

### Migrations fail on the `vector` extension

```
ERROR: extension "vector" is not available
```

The migration history predates the rewrite, and one early migration still runs
`CREATE EXTENSION IF NOT EXISTS vector`. Nothing in the app uses vectors any
more, but `prisma migrate deploy` replays history as written, so a PostgreSQL
without pgvector installed stops there.

Two ways out.

**Give it pgvector.** Use an image that has it — this is what the `.env` above
does, and it keeps the migration history intact:

```bash
echo 'POSTGRES_IMAGE=pgvector/pgvector:pg16' >> .env
docker compose up -d
```

**Or skip the history.** `prisma db push` builds the current schema directly,
and then the search indexes have to be added separately, because `db push`
cannot create expression indexes:

```bash
# Docker
docker compose run --rm db-push

# Bare metal
npx prisma db push
npm run db:indexes
```

The trade-off is that the database no longer has a migration history, so future
`migrate deploy` runs will refuse it — you stay on `db push`. That is the same
escape hatch the README describes for local development.

### The ingester finds no jobs

`0 postings collected` is a real result, not always a bug. Work through it in
this order:

- **`--dry-run` first.** `npx tsx scripts/ingest.ts --country CZ --dry-run`
  scrapes without writing. If that finds postings, the problem is the database
  write, not the crawl.
- **It is incremental.** A second run minutes after the first legitimately
  finds nothing: boards report nothing has changed, and postings already stored
  within the last 12 hours are skipped. Use `--full` to ignore the last-run
  timestamp and walk everything.
- **Check the country has boards.**
  `npx tsx scripts/scrape.ts --list --country CZ` prints which boards apply and
  which are skipped. A country with no local board still gets the worldwide
  remote boards; if the list is empty, the country code is wrong (it is ISO
  3166-1 alpha-2, uppercase).
- **Read the per-board table.** Every run prints one line per board with a
  status. `ERROR:` against all of them points at the network — a server without
  outbound HTTPS, or DNS that does not resolve. One or two failing is normal:
  boards change their markup.
- **Boards that need a browser are skipped**, deliberately. The container image
  ships no browser, and `PLAYWRIGHT_ENABLED` is fixed to `false` for it.
  Ingestion does not need one — JavaScript-heavy boards are walked through
  their sitemaps.
- **Adzuna is off unless keyed.** Without `ADZUNA_APP_ID` and
  `ADZUNA_APP_KEY`, that board is skipped quietly.

### Sign-in fails with `UntrustedHost`

`AUTH_URL` is unset or does not match the hostname the browser used. Set it to
the exact public origin, `https://` included, and restart the app.
`AUTH_TRUST_HOST=true` also works, but `AUTH_URL` is better: it also fixes
OAuth callback URLs.

If Google sign-in specifically fails, the redirect URI registered in the Google
console must be `https://YOUR.DOMAIN/api/auth/callback/google`.

### The build runs out of memory

`next build` is the heaviest thing that happens on the server. On a 1 GB box it
can be killed by the OOM reaper mid-build, which usually looks like the build
stopping with no error at all. Either add swap:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
```

…or build the image on a bigger machine, push it to a registry you control, and
pull it on the server.

### The app is healthy but the domain shows nothing

The app publishes on `127.0.0.1:3000` on purpose, so a browser cannot reach it
directly — only the proxy can. `curl -I http://127.0.0.1:3000/login` on the
server proves the app is up; if that works and the domain does not, the problem
is Caddy or DNS. `sudo journalctl -u caddy -n 50` usually says which.
