-- Add JPEG as an explicitly supported screenshot format without changing
-- the meaning of any existing document or document_file column.
CREATE TABLE documents_phase2_new (
  document_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(user_id),
  title TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('text/plain', 'image/png', 'image/jpeg', 'application/pdf', 'text/html')),
  text TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  data_origin TEXT NOT NULL CHECK (data_origin IN ('synthetic', 'user_provided')),
  created_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

INSERT INTO documents_phase2_new
SELECT document_id, owner_user_id, title, content_type, text, content_sha256, data_origin, created_at, deleted_at
FROM documents;

DROP TABLE documents;
ALTER TABLE documents_phase2_new RENAME TO documents;

CREATE INDEX IF NOT EXISTS idx_documents_owner_created ON documents(owner_user_id, created_at DESC);

CREATE TABLE document_files_phase2_new (
  document_id TEXT PRIMARY KEY REFERENCES documents(document_id) ON DELETE CASCADE,
  content BLOB NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'application/pdf')),
  byte_length INTEGER NOT NULL CHECK (byte_length > 0),
  content_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

INSERT INTO document_files_phase2_new
SELECT document_id, content, content_type, byte_length, content_sha256, created_at
FROM document_files;

DROP TABLE document_files;
ALTER TABLE document_files_phase2_new RENAME TO document_files;

CREATE INDEX IF NOT EXISTS idx_document_files_content_sha256
  ON document_files(content_sha256);
