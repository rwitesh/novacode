import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

// Messages store one canonical AI SDK `ModelMessage` per row as JSON. All of
// role / tool-call / tool-result / reasoning / usage are derivable from that
// single canonical type — no specialized columns, no bespoke serialization.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    cwd TEXT NOT NULL,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    title TEXT,
    parent_session_id TEXT,
    end_reason TEXT,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    context_tokens INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    message TEXT NOT NULL,
    ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
`

let db: DatabaseSync | null = null

export function getDb(path?: string): DatabaseSync {
	if (db) return db

	const dbPath = path ?? join(process.env.HOME ?? "~", ".novacode", "state.db")
	const dir = join(dbPath, "..")
	mkdirSync(dir, { recursive: true })

	db = new DatabaseSync(dbPath, {
		enableForeignKeyConstraints: true,
	})
	db.exec("PRAGMA journal_mode = WAL")
	db.exec(SCHEMA)
	return db
}

export function closeDb(): void {
	if (db) {
		db.close()
		db = null
	}
}

export function resetDb(): void {
	db = null
}
