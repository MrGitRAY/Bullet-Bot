from apscheduler.schedulers.asyncio import AsyncIOScheduler


def create_scheduler(timezone: str) -> AsyncIOScheduler:
    """No jobs yet. Register reminders after persistence and delivery rules are implemented."""
    return AsyncIOScheduler(timezone=timezone, job_defaults={"coalesce": True, "max_instances": 1})
