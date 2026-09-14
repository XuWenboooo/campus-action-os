# Security and privacy

All checked-in examples and fixtures are synthetic. No production endpoint or real key is used. User text is stored only in the local database selected by `DATABASE_PATH`; runtime database files are ignored. Production disables development login. Request IDs and audit events support traceability, while parser and HTTP logs must not print source text, tokens or secrets.
