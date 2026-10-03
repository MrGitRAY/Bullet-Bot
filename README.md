# Bullet Bot

Telegram task bot built entirely on Cloudflare Workers and Cloudflare D1.

Repository: https://github.com/MrGitRAY/Bullet-Bot

## Architecture

Telegram sends updates to a webhook hosted by a Cloudflare Worker. The Worker validates and handles commands, and stores users, tasks, recurring schedules, and completion history in D1 (SQLite). There is no Python runtime, polling process, local SQLite database, or inbound server to maintain.

## Deploy

Requirements: Node.js 20+, a Cloudflare account, and a Telegram bot token from `@BotFather`.

```powershell
cd worker
npm install
npx wrangler login
npx wrangler d1 migrations apply bullet-bot --remote
npx wrangler secret put BOT_TOKEN
npx wrangler secret put WEBHOOK_SECRET
npm run deploy
```

Register the webhook using the deployed Worker URL:

```text
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook
```

Send `url=https://<worker-host>/telegram` and the same `secret_token` used for `WEBHOOK_SECRET`. Keep both values in Cloudflare Secrets; never commit them.

## Development

```powershell
cd worker
npm install
npm run typecheck
npm run dev
```

Use `npm run deploy` after changes. The Worker supports one-time tasks with deadlines and recurring weekly tasks on selected weekdays. See [worker/README.md](worker/README.md) for Wrangler and D1 details.

## Repository layout

- `worker/` — the complete production application, migrations, and deployment configuration.
- `docs/` — architecture and deployment notes.

MIT licensed.
