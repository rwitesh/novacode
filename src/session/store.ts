import { DatabaseSync } from "node:sqlite"
import type { ContentPart, Msg, PendingSession, Session } from "../types.ts"
import { closeDb, getDb } from "./db.ts"

function generateId(): string {
	return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
}

const JSON_SENTINEL = "$json:"

function serializeContent(content: string | ContentPart[]): string | null {
	if (content === undefined || content === null) return null
	if (typeof content === "string") return content
	return JSON_SENTINEL + JSON.stringify(content)
}

function deserializeContent(raw: string | null): string | ContentPart[] {
	if (raw === null) return ""
	if (raw.startsWith(JSON_SENTINEL)) return JSON.parse(raw.slice(JSON_SENTINEL.length))
	return raw
}

function rowToMsg(row: Record<string, unknown>): Msg {
	const role = row.role as string
	const content = deserializeContent(row.content as string | null)
	const ts = row.ts as number

	if (role === "user") {
		return { role: "user", content: content as string | ContentPart[], ts }
	}

	if (role === "assistant") {
		return {
			role: "assistant",
			content: (content || []) as ContentPart[],
			model: (row.model as string) ?? "",
			provider: (row.provider as string) ?? "",
			usage: { in: (row.usage_input as number) ?? 0, out: (row.usage_output as number) ?? 0 },
			stop: (row.stop_reason as "stop" | "length" | "tool_use" | "error" | "aborted") ?? "stop",
			error: undefined,
			ts,
		}
	}

	// tool_result
	return {
		role: "tool_result",
		callId: (row.tool_call_id as string) ?? "",
		tool: (row.tool_name as string) ?? "",
		args: row.tool_args ? JSON.parse(row.tool_args as string) : undefined,
		content: (content || []) as ContentPart[],
		isError: !!(row.is_error as number),
		ts,
	}
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

	async append(sessionId: string, msg: Msg): Promise<void> {
		this.#ensurePersisted(sessionId)
		const now = Date.now()

		const role = msg.role
		let content: string | null = null
		let toolCallId: string | null = null
		let toolName: string | null = null
		let toolArgs: string | null = null
		let model: string | null = null
		let provider: string | null = null
		let usageInput = 0
		let usageOutput = 0
		let stopReason: string | null = null
		let isError = 0

		if (role === "user") {
			content = serializeContent(msg.content)
		} else if (role === "assistant") {
			content = serializeContent(msg.content)
			model = msg.model ?? null
			provider = msg.provider ?? null
			usageInput = msg.usage?.in ?? 0
			usageOutput = msg.usage?.out ?? 0
			stopReason = msg.stop ?? null
			if (msg.error) isError = 1
		} else if (role === "tool_result") {
			content = serializeContent(msg.content)
			toolCallId = msg.callId ?? null
			toolName = msg.tool ?? null
			toolArgs = msg.args ? JSON.stringify(msg.args) : null
			isError = msg.isError ? 1 : 0
		}

		const seqRow = this.#db
			.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM messages WHERE session_id = ?")
			.get(sessionId) as Record<string, unknown>
		const seq = seqRow?.next_seq as number

		this.#db
			.prepare(
				`INSERT INTO messages (session_id, seq, role, content, tool_call_id, tool_name, tool_args, model, provider, usage_input, usage_output, stop_reason, is_error, ts)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				sessionId,
				seq,
				role,
				content,
				toolCallId,
				toolName,
				toolArgs,
				model,
				provider,
				usageInput,
				usageOutput,
				stopReason,
				isError,
				msg.ts ?? now,
			)

		this.#db
			.prepare(
				"UPDATE sessions SET message_count = message_count + 1, updated = ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ? WHERE id = ?",
			)
			.run(now, usageInput, usageOutput, sessionId)
	}

	async messages(sessionId: string): Promise<Msg[]> {
		const rows = this.#db
			.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY seq")
			.all(sessionId) as Record<string, unknown>[]
		return rows.map(rowToMsg)
	}

	async history(sessionId: string): Promise<Msg[]> {
		const lineage = this.#getLineage(sessionId)
		if (lineage.length <= 1) {
			return this.messages(sessionId)
		}

		// Build CASE ordering from lineage (root first, tip last)
		const caseExpr = lineage.map((id, i) => `WHEN '${id}' THEN ${i}`).join(" ")
		const rows = this.#db
			.prepare(
				`SELECT m.* FROM messages m
				 WHERE m.session_id IN (${lineage.map(() => "?").join(",")})
				 ORDER BY CASE m.session_id ${caseExpr} END ASC, m.seq ASC`,
			)
			.all(...lineage) as Record<string, unknown>[]
		return rows.map(rowToMsg)
	}

	async messageCount(sessionId: string): Promise<number> {
		const row = this.#db
			.prepare("SELECT message_count FROM sessions WHERE id = ?")
			.get(sessionId) as Record<string, unknown> | undefined
		return (row?.message_count as number) ?? 0
	}

	async setTitle(sessionId: string, title: string): Promise<void> {
		this.#ensurePersisted(sessionId)
		this.#db
			.prepare("UPDATE sessions SET title = ?, updated = ? WHERE id = ?")
			.run(title, Date.now(), sessionId)
	}

	async replaceMessages(sessionId: string, msgs: Msg[]): Promise<void> {
		if (msgs.length > 0) {
			this.#ensurePersisted(sessionId)
		}
		this.#db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId)
		this.#db
			.prepare("UPDATE sessions SET message_count = 0, updated = ? WHERE id = ?")
			.run(Date.now(), sessionId)

		let seq = 0
		for (const msg of msgs) {
			seq++
			await this.#insertMessage(sessionId, seq, msg)
		}
		this.#db
			.prepare("UPDATE sessions SET message_count = ?, updated = ? WHERE id = ?")
			.run(seq, Date.now(), sessionId)
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
			if (row) {
				current = (row.parent_session_id as string | null) ?? ""
			} else {
				const pending = this.#pendingSessions.get(current)
				current = pending?.parentSessionId ?? ""
			}
		}

		ids.reverse()
		return ids
	}

	async #insertMessage(sessionId: string, seq: number, msg: Msg): Promise<void> {
		const role = msg.role
		let content: string | null = null
		let toolCallId: string | null = null
		let toolName: string | null = null
		let toolArgs: string | null = null
		let model: string | null = null
		let provider: string | null = null
		let usageInput = 0
		let usageOutput = 0
		let stopReason: string | null = null
		let isError = 0

		if (role === "user") {
			content = serializeContent(msg.content)
		} else if (role === "assistant") {
			content = serializeContent(msg.content)
			model = msg.model ?? null
			provider = msg.provider ?? null
			usageInput = msg.usage?.in ?? 0
			usageOutput = msg.usage?.out ?? 0
			stopReason = msg.stop ?? null
			if (msg.error) isError = 1
		} else if (role === "tool_result") {
			content = serializeContent(msg.content)
			toolCallId = msg.callId ?? null
			toolName = msg.tool ?? null
			toolArgs = msg.args ? JSON.stringify(msg.args) : null
			isError = msg.isError ? 1 : 0
		}

		this.#db
			.prepare(
				`INSERT INTO messages (session_id, seq, role, content, tool_call_id, tool_name, tool_args, model, provider, usage_input, usage_output, stop_reason, is_error, ts)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				sessionId,
				seq,
				role,
				content,
				toolCallId,
				toolName,
				toolArgs,
				model,
				provider,
				usageInput,
				usageOutput,
				stopReason,
				isError,
				msg.ts ?? Date.now(),
			)
	}

	async prune(): Promise<void> {
		this.#db.exec("DELETE FROM sessions WHERE message_count = 0")
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
