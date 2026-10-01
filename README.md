# 📒 bullet-bot

An async Telegram Bullet Journal foundation, built with Python 3.12+, Aiogram 3,
SQLAlchemy 2, SQLite and Alembic.

Repository: https://github.com/MrGitRAY/Bullet-Bot

[راهنمای فارسی](docs/README.fa.md)

## Current scope

Implemented: validated environment settings, redacted console logging, database
models and migrations, idempotent user registration, private-chat `/start`, `/menu`
and `/task`, one-time tasks with required deadlines, weekly tasks on selected
weekdays, per-occurrence completion history, task detail/edit/delete flows,
Persian/English keyboards, optional personal allowlist, Docker and tests.

Habit/project/statistics/profile/settings buttons intentionally return a localized
“coming soon” response. Task reminders, projects, `/habit`, `/stats`, XP awards,
charts and reviews are **not implemented**. Scheduler starts without jobs.
Service modules reserve locations for future work; no AI integration is included.

## Windows quick start (PowerShell)

Install standard Python 3.12+ from python.org and Git, then:

```powershell
git clone https://github.com/MrGitRAY/Bullet-Bot.git
cd Bullet-Bot
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
```

Edit `.env`: obtain `BOT_TOKEN` from Telegram **@BotFather**. Set
`ALLOWED_USER_IDS=[123456789]` for personal access (use your own numeric Telegram ID).
An empty list permits any user in private chats. Do not commit `.env`.

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m app.main
```

Open your bot in Telegram and send `/start`. Stop with Ctrl+C. No public server or
inbound port is needed for polling; outbound Telegram access is required. Run one
bot process per token. Disable any previously configured webhook before polling.

Optional activation: `.\.venv\Scripts\Activate.ps1`. If PowerShell blocks scripts,
use the explicit Python paths above. In VS Code select this virtual environment.
Run commands from the repository root so `.env` and Alembic paths resolve correctly.

Supported settings: `BOT_TOKEN`, `DATABASE_URL`, `DEFAULT_LANGUAGE=fa|en`,
`TIMEZONE=Asia/Tehran`, `LOG_LEVEL=INFO`, `ALLOWED_USER_IDS=[]` (JSON array).
Telegram language is used on first registration when supported; otherwise the
configured default applies. Existing user language is preserved.

If Telegram Bot API access is blocked, set `TELEGRAM_PROXY_URL` to an HTTP(S),
SOCKS4, or SOCKS5 proxy, for example
`socks5://username:password@proxy-host:1080`. Telegram Desktop's proxy affects only
that app; copy its SOCKS5/HTTP connection details into `.env`. MTProto proxies cannot
carry Bot API HTTP traffic. Keep proxy credentials only in `.env`, never in
`.env.example` or Git.

## Docker

Install Docker Desktop with Linux containers. Create `.env` as above, then:

```powershell
docker compose up --build -d
docker compose logs -f bot
docker compose down
```

The container runs as an unprivileged user, applies migrations before polling, and
persists SQLite in the `bullet_data` named volume. `docker compose down -v` deletes
that data. Stop the bot before taking a consistent SQLite backup. Compose overrides
the database URL for this volume; edit that override when switching to PostgreSQL.

## Development

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
.\.venv\Scripts\python.exe -m alembic revision --autogenerate -m "describe change"
.\.venv\Scripts\python.exe -m alembic upgrade head
```

Review generated migrations before committing them. Application startup never
silently creates tables. SQLite foreign keys are enabled on every connection.
Supported async database URLs: `sqlite+aiosqlite:///./data/bullet.db` and
`postgresql+asyncpg://user:password@localhost:5432/bullet`.
Changing URL creates a different database; moving existing data requires a separate
export/import and validation process. PostgreSQL integration testing is future work.

See [architecture](docs/architecture.md) and [contribution guide](CONTRIBUTING.md).
Dependencies have compatibility bounds; record a tested deployment lock before
public production rollout. No Telegram token is needed for tests or migrations.

## Next steps

1. Projects, task-to-project assignment and reminders.
2. Idempotent XP transactions tied to task completion.
3. Habit logging with user timezone, streak calculations and completion rates.
4. Durable reminder delivery, retry/deduplication, weekly/monthly reviews and charts.
5. Language/timezone settings, PostgreSQL integration tests and public-use protections.

MIT licensed. This initial foundation does not implement the full roadmap.
