# Signal

AI-powered daily email digest of mortgage industry intelligence for product leaders.

## Application Overview

**Purpose:** Aggregate RSS feeds and scrape competitor newsrooms daily, generate a unified AI-powered digest using Claude, and deliver it via email at 6:30 AM ET. No web frontend — just a health endpoint to keep Replit alive.

**Target User:** Product Manager at Freedom Mortgage responsible for digital mortgage experience.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Daily Pipeline                           │
│  Cron (6:30 AM ET) → Fetch → Insights → Email → Archive    │
├─────────────────────────────────────────────────────────────┤
│                     Data Sources                             │
│        14 RSS Feeds + 3 HTML Scrapers = 17 total            │
├─────────────────────────────────────────────────────────────┤
│                     Storage                                  │
│   PostgreSQL (articles) + JSONL (digest archive)            │
├─────────────────────────────────────────────────────────────┤
│                     AI + Delivery                            │
│    Claude Sonnet 4.5 (insights) + Resend (email)            │
├─────────────────────────────────────────────────────────────┤
│                     Health Server                            │
│           Express.js — GET /health only                      │
└─────────────────────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `server/index.js` | Minimal Express server with `/health` endpoint |
| `server/scheduler.js` | Cron jobs + daily digest pipeline orchestration |
| `server/rssFetcher.js` | RSS feed parsing + newsroom scraper integration |
| `server/newsroomScraper.js` | Cheerio scrapers for Rocket, Blend, ICE newsrooms |
| `server/insightsGenerator.js` | Single unified Claude prompt + weekly summary |
| `server/emailSender.js` | Resend SDK + HTML email template builder |
| `server/archiver.js` | JSONL append/read for digest archive |
| `server/db.js` | PostgreSQL article storage (articles table only) |
| `server/sources.json` | RSS feed configuration (14 sources) |
| `server/migrate-archive.js` | One-time script to export legacy insights_archive to JSONL |

## Database Schema

### `articles` table
Stores fetched RSS articles (cleaned after 90 days)
- `id`, `title`, `link`, `source`, `category`, `type`, `summary`, `original_content`, `image_url`, `pub_date`
- `type` field: `'article'` (default) or `'youtube'`

### Digest Archive (JSONL)
File: `server/data/signal-archive.jsonl` — one JSON object per line, append-only
- Each entry: `{ date, top_insights, competitive_signals, worth_reading, nothing_notable, article_count, source_count }`

## Daily Pipeline

```
6:30 AM ET (cron)
    │
    ▼
┌─────────────────────────┐
│  1. fetchAllFeeds()     │  ← 14 RSS feeds + 3 scrapers
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│  2. getArticles(24h)    │  ← Query last 24 hours from DB
└─────────────────────────┘
    │
    ▼ (if 0 articles → send "nothing new" email, skip Claude)
┌─────────────────────────┐
│  3. generateInsights()  │  ← Single Claude API call
└─────────────────────────┘
    │
    ▼ (if Friday → also generateWeeklySummary())
┌─────────────────────────┐
│  4. sendDigestEmail()   │  ← Resend API
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│  5. appendDigest()      │  ← JSONL archive (always)
└─────────────────────────┘
```

## Data Sources

### Mortgage (RSS)
- HousingWire, Rob Chrisman Commentary, National Mortgage News, MBA Newslink

### Product Management (RSS)
- Lenny's Newsletter, SVPG Articles, Product Talk, One Useful Thing (Ethan Mollick)
- Lenny's Podcast, How I AI Podcast, Supra Insider (YouTube — type: 'youtube')

### Competitor Intel (RSS)
- Rocket Companies (SA), UWM Holdings (SA), loanDepot (SA)

### Competitor Newsrooms (HTML Scrapers)
- Rocket Companies Newsroom (covers Rocket Mortgage + Mr. Cooper post-acquisition)
- Blend Newsroom
- ICE Mortgage Technology

## API Endpoint

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/health` | Returns digest pipeline state (lastDigestRun, articleCount, emailStatus, nextScheduledRun) |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Claude API authentication |
| `RESEND_API_KEY` | Resend email API key |
| `DIGEST_EMAIL` | Recipient email address |
| `RUN_ON_STARTUP` | Set to `true` to run digest on server boot |
| `PORT` | Server port (default: 3001) |

## Skills

When asked to iterate on UI/design, do multiple design passes, or refine visual components, read and follow `.claude/skills/design-iterator/SKILL.md`.
