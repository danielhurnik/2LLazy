# Environment variables

Copy the block below into `.env.local` and fill in the two required values.
Everything after the required section is optional — the app runs without it.

**No AI or LLM API key is required or used by this project.** There is no
`OPENAI_API_KEY`, no embedding service and no model provider, because no code
path calls one. Scraping, extraction, ranking and cover-letter drafting are all
deterministic code you can read in `src/lib`.

Every variable listed here is read somewhere in `src/`, `prisma/` or `scripts/`
(or, for `AUTH_SECRET`, by next-auth itself). Nothing is listed speculatively.

> This project has no committed `.env.example`: the repository's `.gitignore`
> excludes `.env*`, and a stray real `.env` is a worse accident than a missing
> template. This file is the template — copy from the fenced block.

```bash
# --- Required ----------------------------------------------------------------

# PostgreSQL connection string.
#
# Read by:
#   prisma.config.ts   - migrations and `prisma generate`
#   prisma/seed.ts     - via a plain `pg` Pool
#   src/lib/prisma.ts  - the app's runtime client
#
# Any PostgreSQL 14+ server: a container, a local package, or one across the
# network. The app connects with the standard `pg` driver. TLS is opt-in
# through the connection string, e.g. `?sslmode=require`.
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/twollazy?schema=public"

# Secret used by next-auth (Auth.js v5) to sign and encrypt session tokens.
#
# Read by next-auth itself (process.env.AUTH_SECRET, with NEXTAUTH_SECRET as a
# legacy fallback), not by first-party code - so grepping src/ will not find it.
# Without it every auth request fails with MissingSecret.
#
# Generate one with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
AUTH_SECRET="replace-me-with-a-long-random-string"


# --- Optional: more job boards -----------------------------------------------

# Renders JavaScript-heavy boards with a real browser instead of a plain GET.
#
# Read by src/lib/scrapers/playwright-browser.ts, src/lib/scrapers/registry.ts
# and src/lib/data/settings.ts. The value must be the exact string "true";
# anything else counts as off.
#
# When it is off, every board with `requiresBrowser: true` is skipped and the
# Settings page says so. Turning it on adds the boards that need rendering -
# Jooble (local sites in ~60 countries), StartupJobs, Jobs.cz and others.
# Requires `npx playwright install chromium` once.
PLAYWRIGHT_ENABLED="false"

# Adzuna free API tier - adds a local aggregated board in 19 countries
# (GB, US, AT, AU, BE, BR, CA, CH, DE, ES, FR, IN, IT, MX, NL, NZ, PL, SG, ZA).
#
# Read by src/lib/scrapers/boards/adzuna.ts. Both are declared in that board's
# `requiredEnv`, so when either is missing the registry skips the board quietly
# and the Settings page shows "Set ADZUNA_APP_ID and ADZUNA_APP_KEY to enable"
# rather than failing a search.
#
# Register for free at https://developer.adzuna.com/ to get a pair.
ADZUNA_APP_ID=""
ADZUNA_APP_KEY=""

# Fallback country when nothing else identifies the user.
#
# Read by src/lib/data/settings.ts, after the saved profile and before the
# built-in default of "US" (src/lib/geo/countries.ts). ISO 3166-1 alpha-2.
# Country detection for an actual search is: explicit choice > saved profile >
# CDN geo header > Accept-Language > default (src/lib/geo/detect.ts).
DEFAULT_COUNTRY="US"


# --- Optional: Google sign-in and calendar -----------------------------------

# Google OAuth client credentials.
#
# GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are read by src/auth.ts (the Google
# provider) and src/lib/googleCalendar.ts (refresh-token exchange).
# NEXT_PUBLIC_GOOGLE_CLIENT_ID is read in the browser by
# src/app/settings/_components/GoogleCalendarCard.tsx to build the incremental
# consent URL for calendar scope; it is the same client id, exposed to the
# client because NEXT_PUBLIC_ variables are inlined at build time.
#
# Without these, the Google button on /login and calendar sync do not work.
# Credentials sign-in and everything else does.
#
# Create an OAuth client at https://console.cloud.google.com/apis/credentials
# with redirect URI http://localhost:3000/api/auth/callback/google
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
NEXT_PUBLIC_GOOGLE_CLIENT_ID=""

# AES-256-GCM key protecting stored OAuth tokens.
#
# Read by src/lib/crypto.ts (encrypt/decrypt), which throws unless the value is
# exactly 64 hex characters (32 bytes). Only src/lib/crypto.ts reads it, and at
# the time of writing only tests/unit/crypto.test.ts imports that module - so
# the app boots without it, but set it before wiring encryption into a feature.
#
# Generate one with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=""


# --- Optional: development ---------------------------------------------------

# iron-session cookie password.
#
# Read by src/lib/session.ts, which throws at import time when the value is
# missing or shorter than 32 characters. Nothing imports that module today
# (the app authenticates through next-auth), so it is inert unless you use it.
#
# Generate one with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_PASSWORD=""

# Seed an existing user instead of the demo account.
#
# Read by prisma/seed.ts (`npx tsx prisma/seed.ts`). Without it the seed uses
# the oldest existing user, and only creates demo@2llazy.local if the database
# has no users at all. Set it to a User.id (a cuid) to attach the sample
# postings, applications and interviews to your own account.
SEED_USER_ID=""
```
