import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import { SessionStore } from "../src/session/store.ts"
import type { Msg } from "../src/types.ts"

async function createTempStore() {
	const dir = await mkdtemp(join(tmpdir(), "novacode-test-"))
	const dbPath = join(dir, "state.db")
	const db = new DatabaseSync(dbPath)
	db.exec("PRAGMA journal_mode = WAL")
	db.exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY, cwd TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL,
			title TEXT, parent_session_id TEXT, end_reason TEXT, created INTEGER NOT NULL,
			updated INTEGER NOT NULL, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
			message_count INTEGER DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
			seq INTEGER NOT NULL, role TEXT NOT NULL, content TEXT, tool_call_id TEXT, tool_name TEXT,
			tool_args TEXT, model TEXT, provider TEXT, usage_input INTEGER DEFAULT 0, usage_output INTEGER DEFAULT 0,
			stop_reason TEXT, is_error INTEGER DEFAULT 0, ts INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated DESC);
		CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
	`)
	const store = new SessionStore(db)
	return { dir, store, db }
}

describe("SessionStore", () => {
	it("should create and get a session", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")

			expect(typeof session.id).toBe("string")
			expect(session.cwd).toBe("/test/dir")
			expect(session.model).toBe("test-model")
			expect(session.provider).toBe("test-provider")
			expect(session.title).toBeNull()
			expect(session.parentSessionId).toBeNull()
			expect(session.endReason).toBeNull()
			expect(session.messageCount).toBe(0)

			const fetched = await store.get(session.id)
			expect(fetched).not.toBeNull()
			expect(fetched?.id).toBe(session.id)
			expect(fetched?.cwd).toBe(session.cwd)
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("should append and retrieve messages", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")

			const msg1: Msg = {
				role: "user",
				content: "hello",
				ts: Date.now(),
			}
			const msg2: Msg = {
				role: "assistant",
				content: [{ type: "text", text: "world" }],
				model: "test-model",
				provider: "test-provider",
				usage: { in: 10, out: 20 },
				stop: "stop",
				ts: Date.now() + 1000,
			}

			await store.append(session.id, msg1)
			await store.append(session.id, msg2)

			const msgs = await store.messages(session.id)
			expect(msgs).toHaveLength(2)
			expect(msgs[0]!.role).toBe("user")
			expect(msgs[1]!.role).toBe("assistant")
			expect(await store.messageCount(session.id)).toBe(2)
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("should serialize and deserialize ContentPart[] round-trip", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")

			const msg: Msg = {
				role: "assistant",
				content: [
					{ type: "text", text: "hello" },
					{ type: "tool_call", id: "call_1", name: "read", args: { path: "/foo" } },
				],
				model: "test-model",
				provider: "test-provider",
				usage: { in: 5, out: 10 },
				stop: "tool_use",
				ts: Date.now(),
			}

			await store.append(session.id, msg)
			const msgs = await store.messages(session.id)
			expect(msgs).toHaveLength(1)
			expect(msgs[0]!.role).toBe("assistant")
			const content = (msgs[0] as typeof msg).content
			expect(Array.isArray(content)).toBe(true)
			expect(content).toHaveLength(2)
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("should track token usage on append", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")

			const msg: Msg = {
				role: "assistant",
				content: [{ type: "text", text: "response" }],
				model: "test-model",
				provider: "test-provider",
				usage: { in: 100, out: 50 },
				stop: "stop",
				ts: Date.now(),
			}

			await store.append(session.id, msg)
			const s = await store.get(session.id)
			expect(s!.inputTokens).toBe(100)
			expect(s!.outputTokens).toBe(50)
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("should session split on compaction via endSession + createContinuation", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const parent = await store.create("/test/dir", "test-model", "test-provider")

			// Add messages to parent
			for (let i = 0; i < 5; i++) {
				await store.append(parent.id, { role: "user", content: `msg ${i}`, ts: Date.now() })
			}

			// End parent and create continuation
			await store.endSession(parent.id, "compacted")
			const child = await store.createContinuation(
				parent.id,
				"/test/dir",
				"test-model",
				"test-provider",
			)

			expect(child.parentSessionId).toBe(parent.id)
			expect(child.endReason).toBeNull()

			// Add summary + tail to child
			await store.append(child.id, { role: "user", content: "[summary]", ts: Date.now() })
			await store.append(child.id, { role: "user", content: "msg 4", ts: Date.now() })

			// Active messages = only child
			const activeMsgs = await store.messages(child.id)
			expect(activeMsgs).toHaveLength(2)

			// History = parent + child
			const fullHistory = await store.history(child.id)
			expect(fullHistory).toHaveLength(7) // 5 parent + 2 child

			// list() hides compacted parent
			const sessions = await store.list(10)
			expect(sessions).toHaveLength(1)
			expect(sessions[0]!.id).toBe(child.id)
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("should walk lineage for multiple compactions", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const s1 = await store.create("/test/dir", "test-model", "test-provider")
			await store.append(s1.id, { role: "user", content: "msg1", ts: Date.now() })

			await store.endSession(s1.id, "compacted")
			const s2 = await store.createContinuation(s1.id, "/test/dir", "test-model", "test-provider")
			await store.append(s2.id, { role: "user", content: "msg2", ts: Date.now() })

			await store.endSession(s2.id, "compacted")
			const s3 = await store.createContinuation(s2.id, "/test/dir", "test-model", "test-provider")
			await store.append(s3.id, { role: "user", content: "msg3", ts: Date.now() })

			// History from leaf walks all 3 sessions
			const fullHistory = await store.history(s3.id)
			expect(fullHistory).toHaveLength(3)
			expect((fullHistory[0] as { content: string }).content).toBe("msg1")
			expect((fullHistory[1] as { content: string }).content).toBe("msg2")
			expect((fullHistory[2] as { content: string }).content).toBe("msg3")
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("should delete a session and cascade to messages", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")
			await store.append(session.id, { role: "user", content: "hello", ts: Date.now() })

			expect(await store.get(session.id)).not.toBeNull()
			const deleted = await store.delete(session.id)
			expect(deleted).toBe(true)
			expect(await store.get(session.id)).toBeNull()
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("should replaceMessages for backwards compatibility", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")
			await store.append(session.id, { role: "user", content: "original", ts: Date.now() })

			// Replace with new messages
			const msg: Msg = { role: "user", content: "replaced", ts: Date.now() }
			await store.replaceMessages(session.id, [msg])

			const activeMsgs = await store.messages(session.id)
			expect(activeMsgs).toHaveLength(1)
			expect((activeMsgs[0] as { content: string }).content).toBe("replaced")
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})
})
