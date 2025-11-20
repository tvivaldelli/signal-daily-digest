# Mortgage Industry News Monitor

## Overview
A full-stack mortgage industry news monitoring application with RSS feed parsing, web scraping, Claude API summarization, and scheduled updates.

## Current State
- React frontend with Vite (running on port 5000)
- Express backend API (running on port 3001)
- RSS feed parser and web scraping capabilities
- Claude API integration for article summarization
- Node-cron scheduled tasks for automatic updates
- In-memory database for article storage
- Webview configured and working

## Project Structure
```
/
├── client/                    # React frontend
│   ├── src/
│   │   ├── components/       # React components
│   │   │   ├── ArticleCard.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   └── FilterBar.jsx
│   │   ├── services/         # API service layer
│   │   │   └── api.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── vite.config.js        # Vite configuration (port 5000)
│   └── package.json
├── server/                    # Express backend
│   ├── index.js              # Main server file
│   ├── rssFetcher.js         # RSS feed parsing
│   ├── claudeSummarizer.js   # Claude API integration
│   ├── scheduler.js          # Cron job scheduler
│   ├── db.js                 # In-memory database
│   ├── sources.json          # News source configuration
│   └── package.json
└── replit.md                 # This file
```

## Recent Changes
- 2025-11-20: Initial project setup with Node.js 20
- 2025-11-20: Configured Vite to run on port 5000 for Replit webview
- 2025-11-20: Added strictPort: true to prevent auto-port switching
- 2025-11-20: Configured workflows (Backend Server, Frontend App) with webview support

## Configuration Notes
- **Critical**: Frontend must run on port 5000 for Replit webview to work
- Vite configured with `strictPort: true` to enforce port 5000
- Backend runs on port 3001 (internal only)
- Frontend workflow uses `output_type: webview` and `wait_for_port: 5000`

## User Preferences
None specified yet

## Next Steps
- Application is fully configured and accessible via webview
- User can customize news sources in server/sources.json
- Ready for deployment if needed
