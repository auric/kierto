-- Downloaded task attachments (plan r3 WP0). A row exists only for a downloaded file.
-- att_id: the source ID, digits only. file: the path under <dataDir>/attachments. image, text, include: 1 or 0. downloaded_at: ms.
CREATE TABLE task_attachment (
  pr INTEGER NOT NULL,
  key TEXT NOT NULL,
  att_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL,
  file TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  image INTEGER NOT NULL,
  text INTEGER NOT NULL,
  include INTEGER NOT NULL DEFAULT 0,
  downloaded_at INTEGER NOT NULL,
  PRIMARY KEY (pr, key, att_id),
  FOREIGN KEY (pr, key) REFERENCES task_context (pr, key) ON DELETE CASCADE
) WITHOUT ROWID;
