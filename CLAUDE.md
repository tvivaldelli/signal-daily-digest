# Signal Daily Digest

AI-powered daily email digest delivering mortgage industry intelligence and product management content. Headless backend pipeline — no web frontend.

## Architecture

- **Runtime:** Node.js (ES Modules) + Express on port 3001
- **Database:** SQLite via better-sqlite3, stored at `~/.local/share/signal-digest/articles.db`
- **AI:** Claude Sonnet (claude-sonnet-4-6, fallback to claude-sonnet-4-5) via Anthropic SDK
- **Email:** Resend (from `onboarding@resend.dev`, free tier)
- **Archive:** Append-only JSONL at `server/data/signal-archive.jsonl`

## Deployment

Runs on a **Hetzner VPS** (Tailscale IP: `100.99.202.60`) as a **systemd user service** under the `nanobot` user.

```
~/.config/systemd/user/signal-digest.service
```

**Key commands:**
```bash
systemctl --user status signal-digest
systemctl --user restart signal-digest
journalctl --user -u signal-digest -f
```

Node is managed via nvm — the service file uses the absolute path (`/home/nanobot/.nvm/versions/node/v22.22.0/bin/node`). If node is upgraded, update `ExecStart` in the service file.

Lingering is enabled (`loginctl enable-linger nanobot`) so the service runs without an active SSH session.

## Scheduling

Internal `node-cron` handles all scheduling (no external cron entry needed since systemd keeps the process alive):

- **Daily digest:** 6:30 AM ET (`30 6 * * *`)
- **Article cleanup:** Sunday midnight ET — deletes articles older than 90 days

An external cron-job.org trigger may still point at the old Replit URL as a legacy fallback. It can be removed once VPS stability is confirmed.

## Daily Pipeline Flow

1. **Fetch** — `rssFetcher.js` parses 15 RSS feeds from `sources.json` (mortgage news, product management, competitor Seeking Alpha feeds, YouTube channels). `newsroomScraper.js` scrapes 7 competitor newsrooms via Cheerio.
2. **Store** — Articles upserted into SQLite `articles` table. Deduplication on `link` (UNIQUE constraint).
3. **Query** — Pull articles from last 24 hours.
4. **Dedup** — Query `featured_articles` table for recently featured URLs. Exclusion windows: 7 days for top_insights/competitive_signals, 14 days for pm_craft, 30 days for worth_reading. If fewer than `SLOW_DAY_THRESHOLD` (2) non-excluded candidates remain, skip Claude and send a "slow day" email.
5. **Analyze** — Single Claude API call generates structured digest with two tracks: mortgage intelligence (top insights, competitive signals) and PM craft. Plus worth-reading links. 180s timeout, retry with model fallback.
6. **Email** — HTML email via Resend to `DIGEST_EMAIL`.
7. **Write-back** — On successful email send only, write featured URLs to `featured_articles` table (upsert). Failed sends and dry-runs do not write back.
8. **Archive** — Append digest JSON to JSONL file. On Fridays, generates weekly summary from last 5 archived digests. Slow-day digests archived with `slow_day: true`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Pipeline status JSON (last run, article count, next scheduled run, errors) |
| GET | `/run-digest?token=SECRET` | Manual trigger (auth via `CRON_SECRET` query param) |
| GET | `/run-digest?token=SECRET&dry_run=true` | Cheap dry-run: exclusion report, no Claude call, no send |
| GET | `/run-digest?token=SECRET&dry_run_with_claude=true` | Expensive dry-run: runs Claude, skips send + write-back |
| GET | `/read/:id` | Article reader page (linked from digest emails) |

## Environment Variables

Defined in `server/.env` (loaded by dotenv). Template at `server/.env.example`.

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API for insight generation |
| `RESEND_API_KEY` | Resend email delivery |
| `DIGEST_EMAIL` | Recipient email address |
| `CRON_SECRET` | Auth token for `/run-digest` endpoint |
| `APP_URL` | Base URL for reader links in emails (`http://100.99.202.60:3001`) |

## File Structure

```
server/
  index.js            — Express server + endpoints
  db.js               — SQLite (better-sqlite3) — articles + featured_articles tables, CRUD ops
  scheduler.js        — node-cron jobs + pipeline orchestration
  rssFetcher.js       — RSS parsing + YouTube enrichment
  newsroomScraper.js  — Cheerio scrapers for 7 competitor newsrooms
  insightsGenerator.js — Claude API integration + cross-digest dedup exclusions
  emailSender.js      — Resend email builder + sender (incl. slow-day template)
  archiver.js         — JSONL append/read for digest archive
  sources.json        — RSS feed configuration (15 sources)
  data/signal-archive.jsonl — Digest archive
scripts/
  dedup-status.js     — npm run dedup:status — featured article counts + worst offenders
  dedup-reset.js      — npm run dedup:reset — truncate featured_articles (with confirmation)
  migrate-add-pm-craft.js — One-time migration: drop CHECK constraint for pm_craft support
test/
  dedup.test.js       — 13 tests covering exclusion windows, slow-day, write-back guards, pm_craft, VALID_SECTIONS
```

**Two-package layout:** there are two `package.json` files — the root one is a thin wrapper (scripts: `start`, `test`, `dedup:*`) and `server/package.json` holds the runtime dependencies. On the VPS, `node_modules` lives under `server/` only. Scripts that require app modules must resolve against `server/node_modules`.

## Cross-Digest Dedup

The `featured_articles` table prevents the same article from dominating consecutive digests. Key design points:

- **URL is the primary key** — one row per URL regardless of section
- **Valid sections** defined by `VALID_SECTIONS` in db.js: `top_insight`, `competitive_signal`, `pm_craft`, `worth_reading`
- **Section-specific exclusion windows:** 7 days for `top_insight` and `competitive_signal`, 14 days for `pm_craft`, 30 days for `worth_reading`
- **App-level validation** — `markArticleFeatured` throws on invalid section names (CHECK constraint was removed in favor of `VALID_SECTIONS` Set)
- **Write-back only on successful Resend delivery** — failed sends and dry-runs never pollute the table
- **Slow-day threshold** (`SLOW_DAY_THRESHOLD = 2` in insightsGenerator.js) — if fewer than 2 non-excluded candidates remain, skip Claude and send minimal email
- **Candidates filtered server-side** — excluded URLs are removed before Claude sees them, so the AI never has to decide whether to re-feature something

## Recent Changes (2026-05-04)

- **pm_craft section shipped** — 5 commits adding a dedicated Product Craft section to the daily digest. PM articles are now evaluated on PM merit alone, not mortgage relevance. Anti-contortion rules in the Claude prompt prevent cross-contamination between mortgage and PM tracks.
- **Schema migration** — `featured_articles` CHECK constraint replaced with app-level validation (`VALID_SECTIONS` in db.js). Migration script at `scripts/migrate-add-pm-craft.js`.
- **Test suite expanded** — 7 → 13 tests. New coverage: pm_craft round-trip, 14-day window boundaries, VALID_SECTIONS enforcement, invalid section rejection.
- **README rewritten** — Updated for current architecture (SQLite, Hetzner VPS, systemd). Removed stale PostgreSQL/Replit references. Public-audience framing.
- **ISC LICENSE added** at repo root.

## Backlog

Priority order. Items 1-3 date from 2026-05-04; items 6-9 were surfaced incidentally during the 2026-07-11 date-corruption investigation — all of them ran silently, none is fixed yet.

1. **SIGTERM handler in server/index.js** — Call `db.close()` on SIGTERM/SIGINT before process exit. Highest priority. The WAL journal may not flush properly when systemd stops the process, which could explain the empty `featured_articles` table observed before tonight's migration. Without a clean shutdown, SQLite WAL writes can be lost.

2. **Monitor dedup:status for 5-7 mornings** — Run `npm run dedup:status` daily to confirm `featured_articles` rows accumulate after each digest. If they don't, the SIGTERM fix didn't address the root cause and there's a deeper issue with write-back persistence.

3. **competitive_signals health check** — Was producing 0 items 4 of the last 7 days before the prompt rewrite. Tonight's rewrite (two-track prompt with explicit section criteria) produced 3. Need 5-7 more digests to confirm the fix holds. If it regresses, the prompt criteria for competitive_signals may need tightening.

4. **Weekly summarizer ignores worth_reading** — The Friday summary only synthesizes top_insights, competitive_signals, and pm_craft. worth_reading items are excluded from the weekly digest summary. Pre-existing limitation, not introduced in the pm_craft work. Low priority since worth_reading is a catch-all section without strong thematic value.

5. **Upsert quirk in markArticleFeatured** — The `ON CONFLICT (url)` upsert bumps `last_featured_date` and `feature_count` but does not update the `section` field. If the same URL appears in `top_insight` one day and `worth_reading` the next, it keeps its original section. Edge case; low priority since cross-section URL reuse is rare and the dedup filter removes the URL from all sections anyway.

6. **Dead sources (found 2026-07-11, parked)** — 5 of 8 competitor-intel sources contribute nothing: UWM Newsroom (HTTP 403, zero rows ever), Beeline Blog (HTTP 404, zero rows ever), MBA Newslink (feed returns HTTP 200 but zero `<item>` elements, zero rows ever), Rocket Companies Newsroom (HTTP 403, no new rows since 2026-05-28), ICE Mortgage Technology (re-upserts the same 2 stale press releases each run — one dated 2025-05-19 — while logging "found 2 articles"). All fail at the HTTP/feed layer, not in date parsing. `scrapeNewsroom` swallows every failure and returns `[]`, so none of this is visible in normal operation. Repairs deliberately deferred out of the 2026-07 date-corruption fix arc. Related latent bug: `newsroomScraper.js` calls `new Date(dateText).toISOString()` (Rocket/UWM/ICE parsers), which throws on unparseable dates and would silently kill the whole scraper — not currently firing.

7. **`npm test` is a loaded gun against prod** — the suite executes `DELETE FROM featured_articles` against the `homedir()`-resolved DB, which on the VPS is the production database. Never run `npm test` on the VPS. Fix is scoped into the guards arc: require an explicit env var (e.g. `SIGNAL_DB_PATH`) for the test DB path, assert at suite start that it does not resolve to the production path, fail hard if unset.

8. **`server/data/signal-archive.jsonl` is tracked in git** — app-written state inside the repo means every deploy is a potential merge conflict against live data. It dirtied the VPS tree on the 2026-07-11 deploy and needed a stash/pop around the pull. Should be gitignored, with a decision on what to do with the committed history (the tracked copy is frozen at an old state anyway).

9. **`/health` lies about its own schedule** — `nextScheduledRun` is computed with `setHours(6, 30)` in server local time (UTC on the VPS) and stringified as `2026-07-12T06:30:00.000Z`, but the cron actually fires at 6:30 AM ET = 10:30 UTC. Cosmetic, but the endpoint misreports the one fact it exists to report.

## Rules

- **No web frontend.** This is a headless pipeline. The only UI is the email digest.
- **Don't touch digest logic** (insightsGenerator, emailSender, rssFetcher, newsroomScraper, scheduler pipeline) without explicit instruction.
- **Don't add `pg` or PostgreSQL.** The database was migrated to SQLite — that's intentional.
- **Don't modify the `articles` table schema.** Dedup uses the separate `featured_articles` table.
- Secrets live in `server/.env` — never commit this file.
