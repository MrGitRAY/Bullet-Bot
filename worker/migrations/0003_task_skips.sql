CREATE TABLE task_skips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    occurrence_date TEXT NOT NULL,
    skipped_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(task_id, occurrence_date)
);

CREATE INDEX ix_task_skips_user_date ON task_skips(user_id, occurrence_date);
