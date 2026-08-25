# Job sources

A catalogue of places 2LLazy can pull postings from, what it takes to read each
one, and which are already wired up.

**Excluded by decision:** Indeed and LinkedIn. Both actively block automated
access, neither offers a usable free API, and building against them means a
permanent arms race. Everything below is either a documented public interface
or a site that publishes a sitemap for search engines to read.

## How to read the Access column

| Value | Meaning |
|---|---|
| `JSON` | Public JSON endpoint, no authentication |
| `JSON+key` | Public JSON, free API key required |
| `RSS` | Public feed |
| `sitemap` | No API; `robots.txt` → sitemap → server-rendered JSON-LD detail pages |
| `hostile` | Actively blocks automation; not worth pursuing |

**Verification status matters.** This environment has no outbound internet, so
nothing below is confirmed against a live endpoint by me. "Documented" means the
vendor or a credible third party publishes the interface; "Live" means somebody
has run it from real infrastructure and it worked. Move rows to Live as you
confirm them — `npm run ingest -- --boards <id> --dry-run` is the check.

---

## Already implemented

| Source | Countries | Access | Key | Verified | Notes |
|---|---|---|---|---|---|
| Greenhouse | worldwide | JSON | no | Documented | Per-employer boards; see `ats/employers.ts` |
| Lever | worldwide | JSON | no | Documented | Per-employer boards |
| Ashby | worldwide | JSON | no | Documented | Per-employer; includes compensation |
| SmartRecruiters | worldwide | JSON | no | Documented | Per-employer; list has no description |
| Recruitee | worldwide | JSON | no | Documented | Per-employer, per-subdomain |
| Workable | worldwide | JSON | no | Documented | Per-employer; summary only |
| RemoteOK | worldwide remote | JSON | no | Documented | First array element is a legal notice |
| Jobicy | worldwide remote | JSON | no | Documented | Has a `geo` filter |
| Himalayas | worldwide remote | JSON | no | Documented | |
| We Work Remotely | worldwide remote | RSS | no | Documented | Five category feeds |
| Arbeitnow | EU, mostly DE | JSON | no | Documented | Visa-sponsorship flag; UK feed added 2026 |
| Adzuna | 19 countries | JSON+key | yes | Documented | Free tier; env-gated |
| Jooble | ~60 countries | sitemap | no | Unverified | Country subdomains |
| Jobs.cz | CZ | sitemap | no | Unverified | Largest Czech board |
| StartupJobs | CZ, SK | sitemap | no | Unverified | |
| NoFluffJobs | PL, CZ, SK, DE… | sitemap | no | Unverified | Salary always disclosed |
| Cocuma | CZ | HTML | no | Unverified | |
| Jobstack | CZ | HTML | no | Unverified | |
| Skilleto | CZ | sitemap | no | Unverified | Indexed by technology |

> ⚠️ **Remotive needs re-checking before you rely on it.** Multiple 2026
> reviews report that its free tier now exposes roughly 0.4% of active
> listings, with the rest behind a paid "Accelerator" plan. The public API and
> RSS feed are still documented as existing, but if the free surface really is
> that small the board is close to worthless to us. Run
> `npm run ingest -- --boards remotive --dry-run` and count what comes back
> before leaving it enabled.

---

## Worth adding next

Ordered by value for effort. Everything here is free and needs no browser.

### No key required

| Source | Countries | Access | Why it is worth it |
|---|---|---|---|
| **Hacker News "Who is hiring?"** | worldwide | JSON / RSS | Monthly thread, heavily used by startups. `hnrss.org` proxies the official Algolia search and supports keyword filtering. High signal, tiny implementation. |
| **EURES** | 31 EEA countries | sitemap | The EU's official portal — reportedly 2M+ postings across every member state plus Iceland, Liechtenstein, Norway and Switzerland. Single biggest coverage win available for Europe. |
| **Jobspresso** | worldwide remote | RSS | Curated, hand-reviewed remote listings. |
| **Working Nomads** | worldwide remote | RSS | Remote roles across industries. |
| **NoDesk** | worldwide remote | RSS | Remote-first companies. |
| **Remote.co** | worldwide remote | RSS | Established remote board. |
| **JustRemote** | worldwide remote | sitemap | Filters by job origin. |
| **Landing.jobs** | PT, EU | sitemap | Tech-focused, strong Portugal and EU-remote coverage. |
| **WeAreDevelopers** | DACH, EU | sitemap | Developer-specific, large German-speaking audience. |
| **Welcome to the Jungle** (formerly Otta) | FR, EU, UK | sitemap | Big in France; absorbed Otta's audience. |

### Free key required

| Source | Countries | Access | Notes |
|---|---|---|---|
| **USAJOBS** | US | JSON+key | Every US federal opening. Free key, requires an email header. Federal only — no state, municipal or private roles. |
| **CareerOneStop** | US | JSON+key | US Department of Labor web API. Free, quality-controlled. |
| **Jooble API** | ~60 countries | JSON+key | An official API exists alongside the site. A key would replace our sitemap path with something far more reliable — worth doing if the sitemap route proves flaky. |

---

## Country-specific boards

These are the dominant local boards. None publishes an open API, so each needs
the sitemap path or a small HTML adapter. Listed so contributors know what is
worth their time in their own market.

| Country | Board | Access | Notes |
|---|---|---|---|
| CZ | Prace.cz | sitemap | Leading Czech board; same operator as Jobs.cz |
| CZ / SK / HU | Profesia | sitemap | Dominant in Slovakia, strong in CZ and HU |
| PL | Pracuj.pl | sitemap | Largest Polish portal, has a dedicated IT section |
| DE | StepStone | hostile? | ~100k listings; check `robots.txt` before investing |
| DE / AT / CH | Xing | hostile? | Professional network, DACH-wide |
| NL | Nationale Vacaturebank | sitemap | Biggest Dutch generalist board |
| ES | InfoJobs | sitemap | Dominant Spanish board |
| FR | APEC | sitemap | Official board for *cadres* (managers) |
| FR | France Travail | JSON+key | Public employment service (was Pôle emploi); has an API |
| DACH / NL / ES | Honeypot | sitemap | Reverse-recruiting for developers, relocation-friendly |
| US | Wellfound (was AngelList) | sitemap | Startup roles |
| US | Built In | sitemap | Tech hubs, city-scoped |
| US | Dice | sitemap | Long-running US tech board |

---

## Ruled out

| Source | Why |
|---|---|
| **Indeed** | Excluded by decision. Aggressive bot detection; the partner API is closed to new applicants. |
| **LinkedIn** | Excluded by decision. Terms forbid scraping and enforcement is active. |
| **Glassdoor** | Bot-protected; the old `JobSource` enum value is a leftover, not a working board. |
| **Monster / ZipRecruiter** | Bot-protected, no free public interface. |
| **Google Jobs** | Not a board — it indexes the same JSON-LD we already parse at source. Reading the original board is strictly better. |

---

## Adding one

An API or RSS board is a single file; a sitemap board is a single file plus a
URL pattern. See [`ADDING_A_JOB_BOARD.md`](ADDING_A_JOB_BOARD.md). If the
company you want is on Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee or
Workable, it is not a new board at all — it is one line in
`src/lib/scrapers/boards/ats/employers.ts`.

Before adding a board, check two things:

1. **`robots.txt`.** If it disallows the job paths, do not scrape it. The
   crawler obeys robots and so should the person adding the board.
2. **Whether a detail page is server-rendered.** `curl` a job URL and look for
   `application/ld+json`. If it is there, the sitemap path will work and no
   browser is needed.

## Sources

Compiled from vendor documentation and 2026 board round-ups:
[Greenhouse](https://developers.greenhouse.io/job-board.html),
[Lever](https://github.com/lever/postings-api),
[ATS platforms with public APIs](https://theirstack.com/en/blog/13-ats-platforms-with-public-job-posting-api),
[free jobs APIs compared](https://jobspipe.dev/free-jobs-api),
[EURES](https://eures.europa.eu/index_en),
[USAJOBS](https://jobspipe.dev/guides/usajobs-api),
[CareerOneStop](https://www.careeronestop.org/Developers/WebAPI/jobs-api-updates.aspx),
[hnrss.org](https://hnrss.org/),
[remote board round-up](https://freakingnomads.com/best-remote-job-boards/),
[Remotive free-tier review](https://remote100k.com/blog/is-remotive-legit),
[Czech boards](https://www.jobboardfinder.com/news/best-job-boards-czech-republic/),
[German boards](https://join.com/en/blog/german-job-sites),
[Dutch boards](https://workello.com/job-boards-netherlands/),
[European tech boards](https://www.wearedevelopers.com/en/magazine/best-job-sites-for-developers).
