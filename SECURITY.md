# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub Security Advisories:

> https://github.com/danielhurnik/2LLazy/security/advisories/new

That form is private between you and the maintainers. If you cannot use it,
contact the repository owner through their GitHub profile and ask for a private
channel before sending details.

Please include:

- what the problem is and what an attacker gains from it,
- the affected file, route, or dependency,
- steps to reproduce (a failing request, a payload, a short script),
- the commit or branch you tested against.

You should get an acknowledgement within a week. This is a volunteer project
with no paid on-call, so please be patient — and please give us a reasonable
window to ship a fix before disclosing publicly.

There is no bug bounty. Credit in the release notes is offered unless you ask
to stay anonymous.

## Supported versions

The project has no tagged releases yet. Only the default branch is supported;
fixes land there and nowhere else.

## Scope

In scope — things we want to hear about:

- authentication and session handling (`src/auth.ts`, `src/lib/session.ts`)
- authorisation gaps: any route or GraphQL resolver that returns another user's
  applications, favourites, CVs, or calendar events
- SQL injection, including the raw `$queryRaw` / `$executeRaw` calls in the
  scrape route
- SSRF and command injection through scraped or user-supplied URLs
- XSS in rendered job descriptions or CV text (job descriptions are third-party
  HTML — treat every path that renders them as sensitive)
- handling of the encrypted fields protected by `ENCRYPTION_KEY`, and of the
  Google OAuth access/refresh tokens stored in the `Account` table
- file upload handling under `/api/uploads`
- dependency vulnerabilities that are actually reachable from this codebase

Out of scope:

- vulnerabilities in third-party job boards themselves — report those to the
  board, not to us
- missing security headers on someone's self-hosted deployment, or a
  misconfigured `.env` (a deployment that leaks its own `DATABASE_URL` is a
  deployment bug)
- automated scanner output with no demonstrated impact
- denial of service achieved by simply sending a lot of traffic to your own
  instance
- social engineering of maintainers or contributors

## A note on scraping

This app fetches pages from job boards it does not own. That makes politeness a
security-adjacent concern: a contribution that hammers a third party is a
problem for that third party and for every user running this app.

If you add or change a board scraper:

- **Respect `robots.txt`.** If a board disallows the listing path you want, do
  not scrape it. Prefer a documented API or an RSS feed; several boards
  (Remotive, Arbeitnow, Jobicy, Adzuna) publish one.
- **Respect the board's terms of service.** "Technically fetchable" is not
  permission.
- **Rate-limit yourself.** Use the shared `delay()` helper between paged
  requests and keep the per-board page budget small (`pageBudget()` in
  `src/lib/scrapers/boards/shared.ts`). Do not add concurrency inside a board —
  boards already run in parallel with each other.
- **Back off on 429 and 5xx** rather than retrying tightly. `fetchWithRetry` in
  `src/lib/scrapers/fetcher.ts` already does this; do not bypass it with a bare
  `fetch`.
- **Do not bypass anti-bot measures.** No CAPTCHA solving, no rotating proxies,
  no stolen session cookies. If a board cannot be scraped politely, it does not
  belong in the registry.
- **Never commit credentials** for a board that requires an account. Board
  secrets go in `requiredEnv`, and the registry skips the board when they are
  absent.

## Secrets

Never commit `.env`, `.env.local`, API keys, database URLs, or hashed
passwords. `.gitignore` covers `.env*`; `.env.example` is the only environment
file that belongs in the repository, and it must contain placeholders only.

If you leak a secret in a commit, rotate it first, then tell a maintainer — a
rotated secret in git history is an embarrassment, an unrotated one is an
incident.
