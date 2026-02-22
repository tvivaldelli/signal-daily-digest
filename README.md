# Signal

AI-powered daily email digest that aggregates RSS feeds and web sources, generates insights using Claude, and delivers a curated briefing every morning.

No web frontend — just a pipeline triggered by an external cron service that fetches, analyzes, and emails.

## How It Works

```
External cron (e.g. cron-job.org)
  → GET /run-digest?token=SECRET
    → Fetch RSS feeds + scrape newsrooms
    → Store articles in PostgreSQL
    → Query last 24 hours
    → Generate insights via Claude API
    → Send email via Resend
    → Append digest to JSONL archive
```

The server runs on Replit Autoscale (scales to zero when idle). The `/run-digest` endpoint responds immediately and runs the pipeline in the background, keeping the HTTP connection open to prevent the container from being killed mid-pipeline.

On Fridays, a weekly summary is generated from the last 5 digests and included in the email.

## Project Structure

```
/
├── server/
│   ├── index.js              # Express server — /health, /run-digest, /read/:id
│   ├── scheduler.js          # Cron scheduling + pipeline orchestration
│   ├── rssFetcher.js         # RSS parsing, YouTube enrichment, concurrency limiter
│   ├── newsroomScraper.js    # Cheerio-based HTML scrapers for newsroom pages
│   ├── insightsGenerator.js  # Claude API prompt + response parsing
│   ├── emailSender.js        # Resend SDK + HTML email template
│   ├── archiver.js           # JSONL append/read for digest history
│   ├── db.js                 # PostgreSQL connection pool + article CRUD
│   ├── sources.json          # RSS feed configuration
│   ├── migrate-archive.js    # One-time legacy migration script
│   ├── .env.example          # Environment variable template
│   ├── package.json          # Server dependencies
│   └── data/
│       └── signal-archive.jsonl  # Append-only digest archive
├── package.json              # Root scripts (start, migrate)
└── README.md
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Returns pipeline state: last run time, article count, email status, next scheduled run, last error |
| `GET` | `/run-digest?token=` | Token-protected trigger for the daily pipeline. Called by external cron service |
| `GET` | `/read/:id` | Renders full article content in a clean reader page. Used for articles where the RSS feed provides full text |

## Data Sources

Sources are configured in two places:

### RSS Feeds — `server/sources.json`

```json
{
  "sources": [
    {
      "name": "Display Name",
      "category": "industry",
      "url": "https://example.com/",
      "rss": "https://example.com/feed/"
    }
  ]
}
```

Each source needs a `name`, `category`, `url` (homepage), and `rss` (feed URL). Categories are arbitrary strings used to group articles in the Claude prompt.

YouTube channel feeds are also supported — use URLs like `https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID`. The pipeline auto-detects YouTube feeds, fetches video descriptions, and tags them as `type: "youtube"`.

### HTML Scrapers — `server/newsroomScraper.js`

For sites without RSS feeds, custom Cheerio scrapers extract press releases and news items from HTML pages. Each scraper is a function that receives a Cheerio `$` instance and returns an array of `{ title, link, pubDate }` objects.

To add a new scraper, create a parser function and register it in `scrapeAllNewsrooms()`.

## Setup

### Prerequisites

- Node.js 18+
- PostgreSQL database
- [Anthropic API key](https://console.anthropic.com/)
- [Resend API key](https://resend.com/)

### Install

```bash
npm install
cd server && npm install
```

### Configure

Copy the environment template and fill in your values:

```bash
cp server/.env.example server/.env
```

Required environment variables:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Claude API key |
| `RESEND_API_KEY` | Resend email API key |
| `DIGEST_EMAIL` | Recipient email address |
| `CRON_SECRET` | Shared secret for authenticating `/run-digest` |

Optional:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3001` | Server port |
| `APP_URL` | `https://mortgage-intel-hub.replit.app` | Base URL for reader links in emails |
| `RUN_ON_STARTUP` | `false` | If `true`, runs the digest immediately on server start |

On Replit, use Secrets (lock icon) instead of a `.env` file.

### Run

```bash
npm start
```

Or with auto-reload during development:

```bash
cd server && npm run dev
```

### Trigger the Digest

Manually (replace `YOUR_SECRET`):

```bash
curl "http://localhost:3001/run-digest?token=YOUR_SECRET"
```

For production, point an external cron service (e.g. [cron-job.org](https://cron-job.org)) at your deployed `/run-digest?token=` URL.

## Configuring the Claude Prompt

The insight generation prompt lives in `server/insightsGenerator.js`. It defines:

- **Persona context** — who the digest is for and what they care about
- **Filtering criteria** — what makes an article worth highlighting vs. skipping
- **Output structure** — `top_insights`, `competitive_signals`, `worth_reading` sections

To adapt Signal for a different industry or audience, edit the system prompt in `generateInsights()` to reflect your domain, priorities, and competitors.

### Output Schema

The Claude response is parsed into:

```json
{
  "date": "2026-02-22",
  "top_insights": [
    {
      "headline": "...",
      "explanation": "...",
      "connection": "...",
      "source": "...",
      "url": "..."
    }
  ],
  "competitive_signals": [
    {
      "competitor": "...",
      "signal": "...",
      "implication": "...",
      "url": "..."
    }
  ],
  "worth_reading": [
    {
      "title": "...",
      "reason": "...",
      "url": "..."
    }
  ],
  "nothing_notable": false,
  "article_count": 42,
  "source_count": 12
}
```

## Database

PostgreSQL with a single `articles` table:

| Column | Type | Notes |
|--------|------|-------|
| `id` | `SERIAL` | Primary key |
| `link` | `VARCHAR(2048)` | Unique constraint — deduplicates articles |
| `title` | `TEXT` | |
| `source` | `VARCHAR(255)` | Feed name from `sources.json` |
| `category` | `VARCHAR(255)` | Grouping label |
| `type` | `VARCHAR(50)` | `article` (default) or `youtube` |
| `summary` | `TEXT` | First 300 characters of content |
| `original_content` | `TEXT` | Full article text (HTML stripped) |
| `image_url` | `TEXT` | Featured image |
| `pub_date` | `TIMESTAMP` | Publication date |
| `content_html` | `TEXT` | Sanitized HTML for the reader endpoint |
| `has_full_content` | `BOOLEAN` | `true` when RSS provides full text |
| `saved_at` | `TIMESTAMP` | |
| `created_at` | `TIMESTAMP` | |

The table is auto-created on startup. Articles older than 90 days are cleaned up weekly (Sunday midnight ET).

## Digest Archive

Every digest is appended to `server/data/signal-archive.jsonl` — one JSON object per line, regardless of whether the email succeeds. This archive is used to generate Friday weekly summaries from the last 5 digests.

## Dependencies

| Package | Purpose |
|---------|---------|
| `express` | HTTP server |
| `pg` | PostgreSQL client |
| `@anthropic-ai/sdk` | Claude API |
| `resend` | Email delivery |
| `rss-parser` | RSS feed parsing |
| `cheerio` | HTML scraping |
| `sanitize-html` | HTML sanitization for reader |
| `html-entities` | Decode HTML entities in titles |
| `node-cron` | Internal scheduler (weekly cleanup) |
| `dotenv` | Environment variable loading |

## License

ISC
