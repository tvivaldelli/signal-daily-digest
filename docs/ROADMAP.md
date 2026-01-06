# Future Enhancement Roadmap for Mortgage Intelligence Hub

## Context
- **Current use**: Strategic intelligence tool for product leadership at Freedom Mortgage
- **Near-term**: Sharing with colleagues at Freedom Mortgage
- **Potential future**: Side project SaaS for mortgage industry product leaders

## Vision
Transform from personal tool → team tool → potential SaaS product for mortgage/fintech PMs who need to stay informed without spending hours reading industry news.

---

## SaaS Viability Assessment

### The Paywall Question
Some RSS sources (HousingWire, National Mortgage News, Lenny's Newsletter) have paywalls. Currently you only get RSS summaries, not full content.

**Why this isn't a blocker:**
- Plenty of high-value free sources (Rob Chrisman, MBA Newslink, Redfin, YouTube podcasts, Seeking Alpha feeds)
- Users could add their own feeds (they might have subscriptions you don't)
- The AI synthesizes across sources - that's the real value, not content access
- Position as "intelligence synthesis" not "content aggregation"

**Future opportunities:**
- User-provided custom RSS feeds
- Public signals: press releases, SEC filings, job postings
- LinkedIn company page monitoring
- Twitter/X lists for industry voices

### Value Proposition
| What you're NOT selling | What you ARE selling |
|------------------------|---------------------|
| Access to paywalled content | Time savings (30 sec vs 30 min) |
| News aggregation | AI-synthesized strategic themes |
| Another RSS reader | Actionable recommendations |
| Content library | Morning briefing on autopilot |

---

## Recommended Roadmap

### Phase 1: Foundation (Enable Team Use)
**Goal:** Let colleagues use it with basic personalization

| Feature | Why | Effort | Key Files |
|---------|-----|--------|-----------|
| **Individual user accounts** | Know who's using it, enable personalization, audit trail | 2-3 days | New: `server/auth.js`, `users` table |
| **Email digest** | Passive delivery for busy leaders; Mon/Thu aligned with refresh | 1-2 days | New: `server/emailService.js`, update `scheduler.js` |
| **Basic analytics** | Understand usage, justify investment | 2 hours | Add Plausible script to `client/index.html` |

**Auth approach:** Magic link email (simple, no passwords) or shared team password (even simpler)
**Email approach:** Use Resend, SendGrid, or AWS SES (all have free tiers)

---

### Phase 2: Personalization
**Goal:** Each user has their own experience
**Requires:** Phase 1 (user accounts)

| Feature | Effort |
|---------|--------|
| Saved filter presets | 1 day |
| Custom source lists per user | 2 days |
| Notification preferences (frequency, categories) | 1 day |
| Reading history & bookmarks | 1 day |

---

### Phase 3: Collaboration
**Goal:** Team intelligence, not just individual
**Requires:** Phase 1 (user accounts)

| Feature | Effort |
|---------|--------|
| Notes/annotations on insights | 2 days |
| Share insights via link | 1 day |
| React to insights (helpful/not helpful) | 1 day |
| Comments on articles | 2 days |

---

### Phase 4: SaaS-Ready (If You Go That Route)
**Goal:** Multi-tenant, scalable, monetizable

| Feature | Effort |
|---------|--------|
| Organization/team accounts | 3-4 days |
| User-provided RSS feeds | 2 days |
| Usage-based billing hooks | 2-3 days |
| Admin dashboard | 2-3 days |
| Onboarding flow | 1-2 days |

---

## Quick Wins (< 1 day each)

| Enhancement | Effort | Impact |
|-------------|--------|--------|
| Add Plausible Analytics | 30 min | See who's using it |
| Slack/Teams webhook | 2 hours | Passive delivery to channel |
| PDF export button | 3 hours | Share in meetings |
| Dark mode toggle | 2 hours | User comfort |
| Mobile CSS fixes | 3 hours | On-the-go access |

---

## Feature Deep-Dives

### User Authentication
**Recommended:** Magic link email authentication
- User enters email → receives login link → clicks to authenticate
- No passwords to remember or manage
- Session stored in JWT or cookie
- Can upgrade to SSO later if needed

**Database changes:**
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'viewer',  -- 'admin' or 'viewer'
  preferences JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP
);

CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  token VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL
);
```

### Email Digest
**How it works:**
1. Add email preference to user record (daily/weekly/Mon-Thu/off)
2. Scheduler checks at configured time (e.g., 7am EST)
3. For each user with digest enabled, fetch their preferred categories
4. Format insights into HTML email template
5. Send via email provider API

**Email content:**
- TL;DR bullets (3-5 key takeaways)
- Top 2-3 themes with brief descriptions
- "View full insights" button linking to app
- Unsubscribe link

### Teams/Slack Integration
**How it works:**
1. Create Incoming Webhook in Teams/Slack channel
2. Store webhook URL in environment variables
3. After scheduled insight generation, format as Adaptive Card (Teams) or Block Kit (Slack)
4. POST to webhook URL

**What users see:** Rich card with TL;DR, expandable themes, and link to full app

---

## Technical Foundation (What's Already Built)

**Ready for extension:**
- Multi-category system with category-specific AI prompts
- Insights archive with JSONB storage and search
- Scheduled job framework (node-cron, EST timezone)
- Rate limiting infrastructure
- Three-layer caching (memory → DB → Claude)

**Needs work for team use:**
- No user identity system
- No per-user preferences storage
- No audit logging
- Password security is weak (plaintext in env)

---

## Recommendation

**Start with Phase 1** - it's the foundation for everything else:

1. **Individual accounts** unlock personalization, analytics meaning, and collaboration
2. **Email digest** delivers value without users needing to remember to check
3. **Analytics** helps you understand what's working

The SaaS path is viable but not urgent. Build for your team first, then decide if external expansion makes sense once you see how colleagues use it.

---

## Decisions Made

- **Auth:** Individual accounts (enables future external users)
- **Notifications:** Email digest preferred; Teams webhook as secondary option
- **Competitor intel:** Moderately useful, current category tab sufficient for now
