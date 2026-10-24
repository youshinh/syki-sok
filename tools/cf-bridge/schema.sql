-- D1 schema for syki::sok mobile quick capture buffer
CREATE TABLE IF NOT EXISTS memos (
  id TEXT PRIMARY KEY,
  device TEXT,
  client_time TEXT,
  server_time TEXT,
  geo TEXT,
  content_type TEXT NOT NULL, -- 'text', 'image', 'audio', 'file'
  text_content TEXT,
  filename TEXT,
  file_mime TEXT,
  file_data BLOB,             -- For attachments when R2 is not used (up to 2MB)
  r2_key TEXT,                -- Key in R2 bucket if stored there
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memos_created_at ON memos (created_at ASC);
