# Signal - Replit Agent Guide

## Overview

Signal is an AI-powered daily email digest that delivers mortgage industry intelligence to product leaders. It has **no web frontend** — it's a backend-only pipeline that aggregates content from 14 RSS feeds and 3 HTML-scraped competitor newsrooms, generates insights using Claude (Anthropic), and delivers a curated email briefing via Resend every morning at 6:30 AM ET.

The server runs on Replit Autoscale (scales to zero when idle). An external cron service (cron-job.org) hits the `/run-digest` endpoint daily to trigger the pipeline. On Fridays, a weekly summary of the last 5 digests is included.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Runtime & Server

- **Runtime:** Node.js with ES Modules (`"type": "module"` in package.json)
- **Framework:** Express.js, running from `server/index.js`
- **Entry point:** Root `package.json` runs `cd server && npm start`, which executes `node index.js` inside the `server/` directory
- **Port:** Defaults to `process.env.PORT` or 3001
- **Deployment:** Replit Autoscale (Cloud Run-style — scales to zero, stays alive while HTTP response is open)

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Returns JSON with pipeline status, article counts, last run time |
| GET | `/run-digest?token=SECRET` | Triggers the full pipeline (auth via `CRON_SECRET` query param) |
| GET | `/read/:id` | Returns a single article's content by database ID |
| GET | `/` | Redirects to `/health` |

The `/run-digest` endpoint keeps the HTTP response open until the pipeline completes (can take 2-3 minutes) to prevent Replit Autoscale from killing the container.

### Daily Pipeline Flow

1. **Fetch** — `rssFetcher.js` parses all RSS feeds from `sources.json` with concurrency limiting. `newsroomScraper.js` uses Cheerio to scrape Rocket Companies, Blend, and ICE Mortgage Technology newsrooms.
2. **Store** — New articles are saved to PostgreSQL (`articles` table) via `db.js`. Duplicates are skipped using the `link` column's UNIQUE constraint.
3. **Query** — Articles from the last 24 hours are pulled from the database.
4. **Analyze** — `insightsGenerator.js` sends all articles to Claude API (Sonnet) with a single unified prompt. Returns structured sections: top insights, competitive signals, and worth-reading links. On Fridays, also generates a weekly summary from the last 5 archived digests.
5. **Email** — `emailSender.js` builds an HTML email and sends via Resend SDK.
6. **Archive** — `archiver.js` appends the digest as a JSON line to `server/data/signal-archive.jsonl`.

### Data Storage

- **PostgreSQL** — Single `articles` table for storing fetched articles. Connected via `DATABASE_URL` environment variable using the `pg` library directly (no ORM). Articles older than 90 days are cleaned automatically.
- **JSONL File** — `server/data/signal-archive.jsonl` is an append-only file storing each daily digest as a single JSON line. Used for weekly summaries and historical reference. This replaced a previous PostgreSQL `insights_archive` table (migration script exists at `migrate-archive.js`).

### Database Schema

**`articles` table:**
- `id` SERIAL PRIMARY KEY
- `link` VARCHAR(2048) UNIQUE NOT NULL
- `title` TEXT NOT NULL
- `source` VARCHAR(255)
- `category` VARCHAR(255)
- `type` VARCHAR(50) DEFAULT 'article'
- `summary` TEXT
- `original_content` TEXT
- `content_html` TEXT
- `has_full_content` BOOLEAN DEFAULT false
- `image_url` TEXT
- `pub_date` TIMESTAMP
- `saved_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
- `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP

Indexes on: `source`, `category`, `pub_date`, `saved_at`

### Content Sources (17 total)

**14 RSS Feeds** (configured in `server/sources.json`):
- Mortgage industry: HousingWire, Rob Chrisman, National Mortgage News, MBA Newslink
- Product management: Lenny's Newsletter, SVPG, Product Talk, One Useful Thing (Ethan Mollick)
- Plus additional sources (YouTube channels, fintech feeds)

**3 HTML Scrapers** (in `server/newsroomScraper.js`):
- Rocket Companies press releases
- Blend newsroom
- ICE Mortgage Technology

### Key Design Decisions

1. **No web frontend** — This is intentionally a headless pipeline. The only UI is the email itself. Don't add React, Vite, or any client-side code.
2. **JSONL over database for archives** — Digest archives moved from PostgreSQL to flat JSONL files to reduce database load and simplify the read pattern (only need last N entries).
3. **Single Claude prompt** — All articles go into one unified prompt rather than per-category calls, reducing API costs and latency.
4. **Keep-alive HTTP pattern** — The `/run-digest` endpoint writes headers immediately but keeps the response open until the pipeline finishes, preventing Replit Autoscale from terminating the container mid-pipeline.
5. **External cron** — Uses cron-job.org instead of in-process scheduling for the primary daily trigger (though `node-cron` is installed for potential internal scheduling via `scheduler.js`).

## External Dependencies

### Environment Variables Required

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Claude API for insight generation |
| `RESEND_API_KEY` | Resend email delivery service |
| `CRON_SECRET` | Auth token for `/run-digest` endpoint |
| `DIGEST_RECIPIENT` | Email address to receive the digest |
| `APP_URL` | Base URL for the deployed app (used in email links) |

### Third-Party Services

- **Anthropic Claude API** — Generates daily insights and weekly summaries from article content. Uses Claude Sonnet with a 180-second timeout.
- **Resend** — Email delivery. Currently uses `onboarding@resend.dev` as the from address (development/free tier).
- **cron-job.org** — External cron service that hits `/run-digest` at 6:30 AM ET daily.
- **PostgreSQL** — Provided by Replit's built-in database. Used via the `pg` library with a connection pool (max 10 connections).

### NPM Dependencies (server/)

- `express` — HTTP server
- `@anthropic-ai/sdk` — Claude AI API client
- `resend` — Email sending
- `pg` — PostgreSQL client
- `rss-parser` — RSS/Atom feed parsing
- `cheerio` — HTML scraping (newsrooms)
- `sanitize-html` — Clean HTML content for safe rendering
- `html-entities` — Decode HTML entities in RSS content
- `node-cron` — Cron scheduling (secondary to external cron)
- `dotenv` — Environment variable loading