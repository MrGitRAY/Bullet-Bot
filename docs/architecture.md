# Architecture

Bullet Bot has one supported production path:

```text
Telegram Bot -> Telegram Webhook -> Cloudflare Worker -> Cloudflare D1 (SQLite)
```

The Worker contains the Telegram update handler and task domain logic. D1 stores users, one-time tasks, recurring weekly schedules, and completion records. Secrets are managed by Wrangler/Cloudflare and are never stored in the repository.

Python, Aiogram, local SQLite, Docker polling, and the previous application service layer are retired. All new bot functionality belongs under `worker/` and must preserve webhook and D1 operation.
