CREATE TABLE IF NOT EXISTS document_files (
  document_id TEXT PRIMARY KEY REFERENCES documents(document_id) ON DELETE CASCADE,
  content BLOB NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'application/pdf')),
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  content_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_document_files_content_sha256
  ON document_files(content_sha256);
