import { appendFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Msg, Session } from "../types.ts"

function generateId(): string {
	return `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
}

export class SessionStore {
	#sessionsDir: string

	constructor(sessionsDir: string) {
		this.#sessionsDir = sessionsDir
	}

	#sessionDir(id: string): string {
		return join(this.#sessionsDir, id)
	}

	#metadataPath(id: string): string {
		return join(this.#sessionDir(id), "metadata.json")
	}

	#messagesPath(id: string): string {
		return join(this.#sessionDir(id), "messages.jsonl")
	}

	#historyPath(id: string): string {
		return join(this.#sessionDir(id), "history.jsonl")
	}

	async create(cwd: string, model: string, provider: string): Promise<Session> {
		const id = generateId()
		const now = Date.now()
		const session: Session = {
			id,
			cwd,
			model,
			provider,
			title: null,
			created: now,
			updated: now,
		}

		await mkdir(this.#sessionDir(id), { recursive: true })
		await writeFile(this.#metadataPath(id), JSON.stringify(session, null, 2))
		return session
	}

	async get(id: string): Promise<Session | null> {
		try {
			const data = await readFile(this.#metadataPath(id), "utf-8")
			return JSON.parse(data) as Session
		} catch {
			return null
		}
	}

	async list(limit = 10): Promise<Session[]> {
		try {
			const entries = await readdir(this.#sessionsDir, { withFileTypes: true })
			const dirNames = entries
				.filter((e) => e.isDirectory())
				.map((e) => e.name)
				.sort((a, b) => b.localeCompare(a))

			const candidates = dirNames.slice(0, Math.max(limit * 2, 50))
			const sessions: Session[] = []
			for (const name of candidates) {
				const s = await this.get(name)
				if (s) sessions.push(s)
			}
			sessions.sort((a, b) => b.updated - a.updated)
			return sessions.slice(0, limit)
		} catch {
			return []
		}
	}

	async latest(): Promise<Session | null> {
		const sessions = await this.list(1)
		return sessions[0] ?? null
	}

	async delete(id: string): Promise<boolean> {
		try {
			await rm(this.#sessionDir(id), { recursive: true, force: true })
			return true
		} catch {
			return false
		}
	}

	async deleteAll(): Promise<void> {
		try {
			await rm(this.#sessionsDir, { recursive: true, force: true })
			await mkdir(this.#sessionsDir, { recursive: true })
		} catch {
			// ignore
		}
	}

	async append(sessionId: string, msg: Msg, writeToHistory = true): Promise<void> {
		const session = await this.get(sessionId)
		if (!session) return

		session.updated = Date.now()
		await writeFile(this.#metadataPath(sessionId), JSON.stringify(session, null, 2))

		const line = `${JSON.stringify(msg)}\n`
		await appendFile(this.#messagesPath(sessionId), line)
		if (writeToHistory) {
			await appendFile(this.#historyPath(sessionId), line)
		}
	}

	async messages(sessionId: string): Promise<Msg[]> {
		try {
			const data = await readFile(this.#messagesPath(sessionId), "utf-8")
			const lines = data.split("\n").filter((l) => l.trim().length > 0)
			return lines.map((l) => JSON.parse(l) as Msg)
		} catch {
			return []
		}
	}

	async history(sessionId: string): Promise<Msg[]> {
		try {
			const data = await readFile(this.#historyPath(sessionId), "utf-8")
			const lines = data.split("\n").filter((l) => l.trim().length > 0)
			return lines.map((l) => JSON.parse(l) as Msg)
		} catch {
			return this.messages(sessionId)
		}
	}

	async messageCount(sessionId: string): Promise<number> {
		try {
			const data = await readFile(this.#messagesPath(sessionId), "utf-8")
			const lines = data.split("\n").filter((l) => l.trim().length > 0)
			return lines.length
		} catch {
			return 0
		}
	}

	async setTitle(sessionId: string, title: string): Promise<void> {
		const session = await this.get(sessionId)
		if (!session) return
		session.title = title
		session.updated = Date.now()
		await writeFile(this.#metadataPath(sessionId), JSON.stringify(session, null, 2))
	}

	async replaceMessages(sessionId: string, msgs: Msg[]): Promise<void> {
		const data = msgs.map((m) => JSON.stringify(m)).join("\n") + (msgs.length > 0 ? "\n" : "")
		await writeFile(this.#messagesPath(sessionId), data)
	}

	async prune(limit = 10): Promise<void> {
		try {
			const entries = await readdir(this.#sessionsDir, { withFileTypes: true })
			const dirNames = entries
				.filter((e) => e.isDirectory())
				.map((e) => e.name)
				.sort((a, b) => b.localeCompare(a))

			const targets = limit > 0 ? dirNames.slice(0, limit) : dirNames
			for (const name of targets) {
				const count = await this.messageCount(name)
				if (count === 0) {
					await this.delete(name)
				}
			}
		} catch {
			// ignore
		}
	}

	close(): void {
		// no-op
	}
}

let _store: SessionStore | null = null

export async function getSessionStore(dir?: string): Promise<SessionStore> {
	if (_store) return _store
	const sessionsPath = join(dir ?? join(process.env.HOME ?? "~", ".novacode"), "sessions")
	await mkdir(sessionsPath, { recursive: true })
	_store = new SessionStore(sessionsPath)
	return _store
}
