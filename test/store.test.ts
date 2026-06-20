import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import type { ModelMessage } from "ai"
import { describe, expect, it } from "vitest"
import { SessionStore } from "../src/db/sessionStore.ts"

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, cwd TEXT NOT NULL, model TEXT NOT NULL, provider TEXT NOT NULL,
    title TEXT, parent_session_id TEXT, end_reason TEXT, created INTEGER NOT NULL,
    updated INTEGER NOT NULL, input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL, message TEXT NOT NULL, ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
`

async function createTempStore() {
	const dir = await mkdtemp(join(tmpdir(), "novacode-test-"))
	const dbPath = join(dir, "state.db")
	const db = new DatabaseSync(dbPath)
	db.exec("PRAGMA journal_mode = WAL")
	db.exec(SCHEMA)
	const store = new SessionStore(db)
	return { dir, store, db }
}

const userMsg = (text: string): ModelMessage => ({ role: "user", content: text })
const assistantMsg = (text: string): ModelMessage => ({
	role: "assistant",
	content: [{ type: "text", text }],
})

describe("SessionStore", () => {
	it("should create and get a session", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")
			expect(typeof session.id).toBe("string")
			expect(session.cwd).toBe("/test/dir")
			expect(session.messageCount).toBe(0)

			const fetched = await store.get(session.id)
			expect(fetched?.id).toBe(session.id)
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("should append and retrieve ModelMessage round-trip", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")
			await store.append(session.id, userMsg("hello"))
			await store.append(session.id, assistantMsg("world"))

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

	it("restores tool calls, tool results, and reasoning losslessly", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")

			const convo: ModelMessage[] = [
				userMsg("read foo"),
				{
					role: "assistant",
					content: [
						{ type: "reasoning", text: "thinking about it" },
						{ type: "tool-call", toolCallId: "call_1", toolName: "read", input: { path: "/foo" } },
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "call_1",
							toolName: "read",
							output: { type: "text", value: "file body" },
						},
					],
				},
			]

			for (const m of convo) await store.append(session.id, m)
			const restored = await store.messages(session.id)

			expect(restored).toHaveLength(3)
			expect(restored[0]!.role).toBe("user")

			const asst = restored[1]!
			expect(asst.role).toBe("assistant")
			const asstParts = asst.content as { type: string }[]
			expect(asstParts.find((p) => p.type === "reasoning")).toBeTruthy()
			const tc = asstParts.find((p) => p.type === "tool-call") as unknown as {
				toolCallId: string
				toolName: string
				input: unknown
			}
			expect(tc.toolName).toBe("read")
			expect(tc.input).toEqual({ path: "/foo" })

			const tool = restored[2]!
			expect(tool.role).toBe("tool")
			const tr = (tool.content as { type: string }[]).find(
				(p) => p.type === "tool-result",
			) as unknown as {
				toolCallId: string
				toolName: string
				output: { type: string; value: string }
			}
			expect(tr.toolCallId).toBe("call_1")
			expect(tr.output.value).toBe("file body")
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("tracks token usage via addUsage", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")
			await store.addUsage(session.id, 100, 50)
			await store.addUsage(session.id, 30, 20)
			const s = await store.get(session.id)
			expect(s!.inputTokens).toBe(130)
			expect(s!.outputTokens).toBe(70)
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("session splits on compaction via endSession + createContinuation", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const parent = await store.create("/test/dir", "test-model", "test-provider")
			for (let i = 0; i < 5; i++) await store.append(parent.id, userMsg(`msg ${i}`))

			await store.endSession(parent.id, "compacted")
			const child = await store.createContinuation(
				parent.id,
				"/test/dir",
				"test-model",
				"test-provider",
			)
			expect(child.parentSessionId).toBe(parent.id)

			await store.append(child.id, userMsg("[summary]"))
			await store.append(child.id, userMsg("msg 4"))

			expect(await store.messages(child.id)).toHaveLength(2)
			expect(await store.history(child.id)).toHaveLength(2) // Parent is compacted, lineage boundary stops traversal

			const sessions = await store.list(10)
			expect(sessions).toHaveLength(1)
			expect(sessions[0]!.id).toBe(child.id)
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("walks lineage for multiple compactions", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const s1 = await store.create("/test/dir", "test-model", "test-provider")
			await store.append(s1.id, userMsg("msg1"))
			await store.endSession(s1.id, "compacted")
			const s2 = await store.createContinuation(s1.id, "/test/dir", "test-model", "test-provider")
			await store.append(s2.id, userMsg("msg2"))
			await store.endSession(s2.id, "compacted")
			const s3 = await store.createContinuation(s2.id, "/test/dir", "test-model", "test-provider")
			await store.append(s3.id, userMsg("msg3"))

			const fullHistory = await store.history(s3.id)
			expect(fullHistory).toHaveLength(1) // Compaction boundaries prevent parent leakage
			expect((fullHistory[0] as { content: string }).content).toBe("msg3")
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("deletes a session and cascades to messages", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")
			await store.append(session.id, userMsg("hello"))
			expect(await store.get(session.id)).not.toBeNull()
			expect(await store.delete(session.id)).toBe(true)
			expect(await store.get(session.id)).toBeNull()
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})

	it("replaceMessages overwrites the message history", async () => {
		const { dir, store, db } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")
			await store.append(session.id, userMsg("original"))
			await store.replaceMessages(session.id, [userMsg("replaced")])

			const activeMsgs = await store.messages(session.id)
			expect(activeMsgs).toHaveLength(1)
			expect((activeMsgs[0] as { content: string }).content).toBe("replaced")
		} finally {
			db.close()
			await rm(dir, { recursive: true, force: true })
		}
	})
})
