import { DatabaseSync } from "node:sqlite"
import type { ModelMessage } from "ai"
import type { PendingSession, Session } from "../types.ts"
import { closeDb, getDb } from "./client.ts"

function generateId(): string {
	return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
}

function rowToSession(row: Record<string, unknown>): Session {
	return {
		id: row.id as string,
		cwd: row.cwd as string,
		model: row.model as string,
		provider: row.provider as string,
		title: (row.title as string | null) ?? null,
		parentSessionId: (row.parent_session_id as string | null) ?? null,
		endReason: (row.end_reason as string | null) ?? null,
		created: row.created as number,
		updated: row.updated as number,
		inputTokens: (row.input_tokens as number) ?? 0,
		outputTokens: (row.output_tokens as number) ?? 0,
		messageCount: (row.message_count as number) ?? 0,
	}
}

export class SessionStore {
	#db: DatabaseSync
	#pendingSessions = new Map<string, PendingSession>()

	constructor(dbOrPath?: DatabaseSync | string) {
		if (dbOrPath instanceof DatabaseSync) {
			this.#db = dbOrPath
		} else {
			this.#db = getDb(dbOrPath)
		}
	}

	#ensurePersisted(sessionId: string): void {
		const pending = this.#pendingSessions.get(sessionId)
		if (!pending) return

		this.#db
			.prepare(
				`INSERT OR IGNORE INTO sessions (id, cwd, model, provider, title, parent_session_id, end_reason, created, updated, input_tokens, output_tokens, message_count)
				 VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, 0, 0)`,
			)
			.run(
				sessionId,
				pending.cwd,
				pending.model,
				pending.provider,
				pending.title,
				pending.parentSessionId,
				pending.created,
				pending.created,
			)
		this.#pendingSessions.delete(sessionId)
	}

	async create(cwd: string, model: string, provider: string): Promise<Session> {
		const id = generateId()
		const now = Date.now()
		this.#pendingSessions.set(id, {
			cwd,
			model,
			provider,
			title: null,
			parentSessionId: null,
			created: now,
		})
		return {
			id,
			cwd,
			model,
			provider,
			title: null,
			parentSessionId: null,
			endReason: null,
			created: now,
			updated: now,
			inputTokens: 0,
			outputTokens: 0,
			messageCount: 0,
		}
	}

	async get(id: string): Promise<Session | null> {
		const row = this.#db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as
			| Record<string, unknown>
			| undefined
		if (row) return rowToSession(row)

		const pending = this.#pendingSessions.get(id)
		if (pending) {
			return {
				id,
				cwd: pending.cwd,
				model: pending.model,
				provider: pending.provider,
				title: pending.title,
				parentSessionId: pending.parentSessionId,
				endReason: null,
				created: pending.created,
				updated: pending.created,
				inputTokens: 0,
				outputTokens: 0,
				messageCount: 0,
			}
		}
		return null
	}

	async list(limit = 10): Promise<Session[]> {
		const rows = this.#db
			.prepare("SELECT * FROM sessions WHERE end_reason IS NULL ORDER BY updated DESC LIMIT ?")
			.all(limit) as Record<string, unknown>[]
		return rows.map(rowToSession)
	}

	async latest(): Promise<Session | null> {
		const row = this.#db
			.prepare("SELECT * FROM sessions WHERE end_reason IS NULL ORDER BY updated DESC LIMIT 1")
			.get() as Record<string, unknown> | undefined
		return row ? rowToSession(row) : null
	}

	async delete(id: string): Promise<boolean> {
		const pending = this.#pendingSessions.delete(id)
		const result = this.#db.prepare("DELETE FROM sessions WHERE id = ?").run(id)
		return pending || result.changes > 0
	}

	async deleteAll(): Promise<void> {
		this.#pendingSessions.clear()
		this.#db.exec("DELETE FROM messages; DELETE FROM sessions")
	}

	async append(sessionId: string, msg: ModelMessage): Promise<void> {
		this.#ensurePersisted(sessionId)
		const now = Date.now()

		const seqRow = this.#db
			.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM messages WHERE session_id = ?")
			.get(sessionId) as Record<string, unknown>
		const seq = seqRow?.next_seq as number

		this.#insert(sessionId, seq, msg, now)
		this.#db
			.prepare("UPDATE sessions SET message_count = message_count + 1, updated = ? WHERE id = ?")
			.run(now, sessionId)
	}

	async addUsage(sessionId: string, inputTokens: number, outputTokens: number): Promise<void> {
		this.#ensurePersisted(sessionId)
		this.#db
			.prepare(
				"UPDATE sessions SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, updated = ? WHERE id = ?",
			)
			.run(inputTokens, outputTokens, Date.now(), sessionId)
	}

	async messages(sessionId: string): Promise<ModelMessage[]> {
		const rows = this.#db
			.prepare("SELECT message FROM messages WHERE session_id = ? ORDER BY seq")
			.all(sessionId) as Record<string, unknown>[]
		return rows.map((r) => JSON.parse(r.message as string) as ModelMessage)
	}

	async history(sessionId: string): Promise<ModelMessage[]> {
		const lineage = this.#getLineage(sessionId)
		if (lineage.length <= 1) {
			return this.messages(sessionId)
		}

		// Build CASE ordering from lineage (root first, tip last)
		const caseExpr = lineage.map((id, i) => `WHEN '${id}' THEN ${i}`).join(" ")
		const rows = this.#db
			.prepare(
				`SELECT message FROM messages m
				 WHERE m.session_id IN (${lineage.map(() => "?").join(",")})
				 ORDER BY CASE m.session_id ${caseExpr} END ASC, m.seq ASC`,
			)
			.all(...lineage) as Record<string, unknown>[]
		return rows.map((r) => JSON.parse(r.message as string) as ModelMessage)
	}

	async messageCount(sessionId: string): Promise<number> {
		const row = this.#db
			.prepare("SELECT message_count FROM sessions WHERE id = ?")
			.get(sessionId) as Record<string, unknown> | undefined
		return (row?.message_count as number) ?? 0
	}

	async setTitle(sessionId: string, title: string): Promise<void> {
		const safeTitle = title.replace(/\s+/g, " ").trim().slice(0, 60)
		if (!safeTitle) return
		this.#ensurePersisted(sessionId)
		this.#db
			.prepare("UPDATE sessions SET title = ?, updated = ? WHERE id = ?")
			.run(safeTitle, Date.now(), sessionId)
	}

	async endSession(id: string, reason: string): Promise<void> {
		this.#ensurePersisted(id)
		this.#db
			.prepare("UPDATE sessions SET end_reason = ?, updated = ? WHERE id = ?")
			.run(reason, Date.now(), id)
	}

	async createContinuation(
		parentId: string,
		cwd: string,
		model: string,
		provider: string,
	): Promise<Session> {
		const id = generateId()
		const now = Date.now()
		this.#pendingSessions.set(id, {
			cwd,
			model,
			provider,
			title: null,
			parentSessionId: parentId,
			created: now,
		})

		return {
			id,
			cwd,
			model,
			provider,
			title: null,
			parentSessionId: parentId,
			endReason: null,
			created: now,
			updated: now,
			inputTokens: 0,
			outputTokens: 0,
			messageCount: 0,
		}
	}

	#getLineage(sessionId: string): string[] {
		const ids: string[] = []
		let current = sessionId
		const visited = new Set<string>()

		while (current && !visited.has(current)) {
			ids.push(current)
			visited.add(current)
			const row = this.#db
				.prepare("SELECT parent_session_id FROM sessions WHERE id = ?")
				.get(current) as Record<string, unknown> | undefined

			let parentId: string | null = null
			if (row) {
				parentId = row.parent_session_id as string | null
			} else {
				const pending = this.#pendingSessions.get(current)
				parentId = pending?.parentSessionId ?? null
			}

			if (parentId) {
				const parentRow = this.#db
					.prepare("SELECT end_reason FROM sessions WHERE id = ?")
					.get(parentId) as Record<string, unknown> | undefined
				if (parentRow && parentRow.end_reason === "compacted") {
					current = ""
				} else {
					current = parentId
				}
			} else {
				current = ""
			}
		}

		ids.reverse()
		return ids
	}

	#insert(sessionId: string, seq: number, msg: ModelMessage, ts: number): void {
		this.#db
			.prepare("INSERT INTO messages (session_id, seq, message, ts) VALUES (?, ?, ?, ?)")
			.run(sessionId, seq, JSON.stringify(msg), ts)
	}

	async prune(): Promise<void> {
		try {
			this.#db.exec("DELETE FROM sessions WHERE message_count = 0")
		} catch {
			// DB may be closed after reset
		}
	}

	close(): void {
		closeDb()
	}
}

let _store: SessionStore | null = null

export async function getSessionStore(dir?: string): Promise<SessionStore> {
	if (_store) return _store
	_store = new SessionStore(dir ? `${dir}/state.db` : undefined)
	return _store
}
