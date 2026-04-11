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
4. **Dedup** — Query `featured_articles` table for recently featured URLs. Exclusion windows: 7 days for top_insights/competitive_signals, 30 days for worth_reading. If fewer than `SLOW_DAY_THRESHOLD` (2) non-excluded candidates remain, skip Claude and send a "slow day" email.
5. **Analyze** — Single Claude API call generates structured digest: top insights, competitive signals, worth-reading links. Exclusion lists injected into the prompt as hard constraints. 180s timeout, retry with model fallback.
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
test/
  dedup.test.js       — 7 tests covering exclusion windows, slow-day, write-back guards
```

## Cross-Digest Dedup

The `featured_articles` table prevents the same article from dominating consecutive digests. Key design points:

- **URL is the primary key** — one row per URL regardless of section
- **Section-specific exclusion windows:** 7 days for `top_insight` and `competitive_signal`, 30 days for `worth_reading`
- **Write-back only on successful Resend delivery** — failed sends and dry-runs never pollute the table
- **Slow-day threshold** (`SLOW_DAY_THRESHOLD = 2` in insightsGenerator.js) — if fewer than 2 non-excluded candidates remain, skip Claude and send minimal email
- **Exclusion lists injected into the Claude prompt** between FILTERING CRITERIA and OUTPUT FORMAT, with a reinforcing rule in RULES

## Rules

- **No web frontend.** This is a headless pipeline. The only UI is the email digest.
- **Don't touch digest logic** (insightsGenerator, emailSender, rssFetcher, newsroomScraper, scheduler pipeline) without explicit instruction.
- **Don't add `pg` or PostgreSQL.** The database was migrated to SQLite — that's intentional.
- **Don't modify the `articles` table schema.** Dedup uses the separate `featured_articles` table.
- Secrets live in `server/.env` — never commit this file.
