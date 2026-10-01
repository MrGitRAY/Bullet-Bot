# Architecture and boundaries

`app/bot` handles Telegram routing, keyboards, access control and translations.
`app/services` owns use cases. User registration and task operations are implemented.
`app/database` owns SQLAlchemy models, session creation and versioned migrations.
`app/config` validates deployment settings and configures UTC console logging.
`app/scheduler` creates an async scheduler with no jobs yet.
`locales` contains Persian and English UI text; `tests` runs without Telegram access.

Each accepted message receives its own async session and transaction. Exceptions
roll it back. Services flush; middleware commits. Outbound Telegram delivery is not
atomic with database commits; future reminders/XP need idempotency and an outbox.
Only private chats are accepted. An allowlist is optional for personal deployment.

User is the owner of projects, tasks, habits and XP history. Habit logs are unique
per habit/date. Deleting a user cascades to owned data. Deleting a project preserves
its tasks by setting project_id to null. Future task services must validate that a
project belongs to the acting user; a project foreign key alone does not enforce
tenant ownership. Every future query/mutation must be scoped by authenticated user.

Use UTC instants for deadlines/reminders and convert at service boundaries. SQLite
does not retain timezone offsets; normalize retrieved values as UTC. Habit dates
will use user-local calendar dates once per-user timezone settings are introduced.
repeat_config is reserved JSON; validate it in the future recurrence service.
Current/best streak and XP totals are cached values to update transactionally.
Task completion history is stored as immutable dated events. One-time tasks become
completed permanently. Weekly tasks remain active and receive at most one completion
event for each scheduled local date. Weekdays use ISO values 1 (Monday) through 7
(Sunday); the UI displays them in the natural order for each language.
Task mutations always scope the record to the authenticated Telegram user. Completed
one-time tasks are immutable, while deletion removes their completion history through
database cascades. A task's one-time/weekly kind is intentionally immutable.

No repository abstraction, queue, AI provider or distributed scheduler is needed
for the initial personal bot. Add these only when a concrete feature requires them.
Run a single instance now; in-memory scheduler jobs are not durable or distributed.

API references: [Aiogram polling](https://docs.aiogram.dev/en/latest/dispatcher/dispatcher.html)
and [SQLAlchemy async sessions](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html).
