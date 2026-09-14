# Architecture decisions

- Node 26 `node:sqlite` is used for the local/test database so migration and persistence tests exercise a real SQLite engine without a production dependency.
- Migrations are the only database schema source; runtime databases live under ignored `data/`.
- JSON Schema v1 remains authoritative for public protocol objects. TypeScript types and runtime validators are adapters, not a second semantic contract.
- A deterministic rule parser is enabled for local proof. Real providers remain unconfigured and must not be represented as successful model output.
- Media documents may have empty pre-OCR `Document.text`; their uploaded bytes are stored in the local `document_files` table and are passed only to the injected OCR boundary. This is an implementation of the frozen screenshot/PDF input path, not a claim that OCR has run.
