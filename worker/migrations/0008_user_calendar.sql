ALTER TABLE users ADD COLUMN calendar TEXT NOT NULL DEFAULT 'gregorian'
  CHECK (calendar IN ('gregorian', 'persian'));
