# Contributing

Use Python 3.12+ and follow the README setup. The intended workflow is stable `main`,
integration `develop`, and short-lived `feature/*` branches targeting `develop`.
Create `develop` from the initial `main` commit when publishing this scaffold.

Use commits beginning with `feat:`, `fix:`, `docs:`, `refactor:` or `test:`.
Keep changes small, typed and asynchronous. Every implemented feature needs its
service, database integration, Telegram handler and behavior tests. Do not add
business logic to keyboards or handlers. Include ownership and idempotency cases.

Run Pytest, Ruff lint and Ruff formatting checks before opening a pull request.
Include migrations for schema changes and documentation for user-facing behavior.
Never include tokens, user databases or personal journal content in issues/PRs.
