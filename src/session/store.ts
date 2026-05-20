import { join } from "node:path"
import BetterSqlite3 from "better-sqlite3"
import type { Msg, Session } from "../types.ts"

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	cwd TEXT NOT NULL,
	model TEXT NOT NULL,
	provider TEXT NOT NULL,
	title TEXT,
	created INTEGER NOT NULL,
	updated INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	seq INTEGER NOT NULL,
	role TEXT NOT NULL,
	content TEXT NOT NULL,
	ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);

CREATE TABLE IF NOT EXISTS compactions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
	summary TEXT NOT NULL,
	files_read TEXT NOT NULL DEFAULT '[]',
	files_wrote TEXT NOT NULL DEFAULT '[]',
	seq_before INTEGER NOT NULL,
	ts INTEGER NOT NULL
);
`

function generateId(): string {
	return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
}

export class SessionStore {
	#db: BetterSqlite3.Database

	constructor(dbPath: string) {
		this.#db = new BetterSqlite3(dbPath)
		this.#db.pragma("journal_mode = WAL")
		this.#db.pragma("foreign_keys = ON")
		this.#db.exec(SCHEMA)
	}

	create(cwd: string, model: string, provider: string): Session {
		const id = generateId()
		const now = Date.now()
		this.#db
			.prepare(
				"INSERT INTO sessions (id, cwd, model, provider, title, created, updated) VALUES ($id, $cwd, $model, $provider, $title, $created, $updated)",
			)
			.run({
				id: id,
				cwd: cwd,
				model: model,
				provider: provider,
				title: null,
				created: now,
				updated: now,
			})
		return { id, cwd, model, provider, title: null, created: now, updated: now }
	}

	get(id: string): Session | null {
		return (
			(this.#db
				.prepare(
					"SELECT id, cwd, model, provider, title, created, updated FROM sessions WHERE id = $id",
				)
				.get({ id: id }) as Session | null) ?? null
		)
	}

	list(limit = 50): Session[] {
		return this.#db
			.prepare(
				"SELECT id, cwd, model, provider, title, created, updated FROM sessions ORDER BY updated DESC LIMIT $limit",
			)
			.all({ limit: limit }) as Session[]
	}

	delete(id: string): boolean {
		const result = this.#db.prepare("DELETE FROM sessions WHERE id = $id").run({ id: id })
		return result.changes > 0
	}

	append(sessionId: string, msg: Msg): void {
		const seq = this.#nextSeq(sessionId)
		this.#db
			.prepare(
				"INSERT INTO messages (session_id, seq, role, content, ts) VALUES ($sid, $seq, $role, $content, $ts)",
			)
			.run({
				sid: sessionId,
				seq: seq,
				role: msg.role,
				content: JSON.stringify(msg),
				ts: msg.ts,
			})
		this.#db
			.prepare("UPDATE sessions SET updated = $now WHERE id = $id")
			.run({ now: Date.now(), id: sessionId })
	}

	appendMany(sessionId: string, msgs: Msg[]): void {
		const tx = this.#db.transaction(() => {
			for (const msg of msgs) {
				this.append(sessionId, msg)
			}
		})
		tx()
	}

	messages(sessionId: string): Msg[] {
		const rows = this.#db
			.prepare("SELECT content FROM messages WHERE session_id = $sid ORDER BY seq ASC")
			.all({ sid: sessionId }) as { content: string }[]
		return rows.map((r) => JSON.parse(r.content) as Msg)
	}

	messagesAfter(sessionId: string, afterSeq: number): Msg[] {
		const rows = this.#db
			.prepare(
				"SELECT content FROM messages WHERE session_id = $sid AND seq > $seq ORDER BY seq ASC",
			)
			.all({ sid: sessionId, seq: afterSeq }) as { content: string }[]
		return rows.map((r) => JSON.parse(r.content) as Msg)
	}

	setTitle(sessionId: string, title: string): void {
		this.#db
			.prepare("UPDATE sessions SET title = $title WHERE id = $id")
			.run({ title: title, id: sessionId })
	}

	messageCount(sessionId: string): number {
		const row = this.#db
			.prepare("SELECT COUNT(*) as count FROM messages WHERE session_id = $sid")
			.get({ sid: sessionId }) as { count: number }
		return row.count
	}

	saveCompaction(
		sessionId: string,
		summary: string,
		filesRead: string[],
		filesWrote: string[],
		seqBefore: number,
	): void {
		this.#db
			.prepare(
				"INSERT INTO compactions (session_id, summary, files_read, files_wrote, seq_before, ts) VALUES ($sid, $summary, $read, $wrote, $seq, $ts)",
			)
			.run({
				sid: sessionId,
				summary: summary,
				read: JSON.stringify(filesRead),
				wrote: JSON.stringify(filesWrote),
				seq: seqBefore,
				ts: Date.now(),
			})
	}

	getLatestCompaction(sessionId: string): { summary: string; seqBefore: number } | null {
		return (
			(this.#db
				.prepare(
					"SELECT summary, seq_before FROM compactions WHERE session_id = $sid ORDER BY ts DESC LIMIT 1",
				)
				.get({ sid: sessionId }) as { summary: string; seqBefore: number } | null) ?? null
		)
	}

	truncateBeforeSeq(sessionId: string, seq: number): void {
		this.#db
			.prepare("DELETE FROM messages WHERE session_id = $sid AND seq < $seq")
			.run({ sid: sessionId, seq: seq })
	}

	close(): void {
		this.#db.close()
	}

	#nextSeq(sessionId: string): number {
		const row = this.#db
			.prepare("SELECT MAX(seq) as maxSeq FROM messages WHERE session_id = $sid")
			.get({ sid: sessionId }) as { maxSeq: number | null }
		return (row.maxSeq ?? 0) + 1
	}
}

let _store: SessionStore | null = null

export function getSessionStore(dir?: string): SessionStore {
	if (_store) return _store
	const dbPath = join(dir ?? join(process.env.HOME ?? "~", ".novacode"), "sessions.db")
	_store = new SessionStore(dbPath)
	return _store
}
