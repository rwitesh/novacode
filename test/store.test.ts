import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { SessionStore } from "../src/session/store.ts"
import type { Msg } from "../src/types.ts"

async function createTempStore() {
	const path = await mkdtemp(join(tmpdir(), "novacode-test-"))
	const store = new SessionStore(path)
	return { path, store }
}

describe("SessionStore", () => {
	it("should create and get a session", async () => {
		const { path, store } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")

			expect(typeof session.id).toBe("string")
			expect(session.cwd).toBe("/test/dir")
			expect(session.model).toBe("test-model")
			expect(session.provider).toBe("test-provider")
			expect(session.title).toBeNull()

			const fetched = await store.get(session.id)
			expect(fetched).not.toBeNull()
			expect(fetched?.id).toBe(session.id)
			expect(fetched?.cwd).toBe(session.cwd)
		} finally {
			await rm(path, { recursive: true, force: true })
		}
	})

	it("should append and retrieve messages", async () => {
		const { path, store } = await createTempStore()
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
				usage: { in: 0, out: 0 },
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
			await rm(path, { recursive: true, force: true })
		}
	})

	it("should support separate active messages and full history backups during compaction", async () => {
		const { path, store } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")

			const msg1: Msg = { role: "user", content: "hello", ts: Date.now() }
			const msg2: Msg = {
				role: "assistant",
				content: [{ type: "text", text: "world" }],
				model: "test-model",
				provider: "test-provider",
				usage: { in: 0, out: 0 },
				stop: "stop",
				ts: Date.now() + 1000,
			}
			const summaryMsg: Msg = {
				role: "user",
				content: "[Prior context summary]\nAll is compacted",
				ts: Date.now() + 2000,
			}

			// Append normal messages
			await store.append(session.id, msg1)
			await store.append(session.id, msg2)

			// Replace active messages (cache-optimized order: summaryMsg first)
			await store.replaceMessages(session.id, [summaryMsg, msg1, msg2])

			// In active messages, we should have all 3 messages with summaryMsg at index 0
			const activeMsgs = await store.messages(session.id)
			expect(activeMsgs).toHaveLength(3)
			expect(activeMsgs[0]!.content).toContain("[Prior context summary]")
			expect(activeMsgs[1]!.content).toBe("hello")

			// In backup history, we should only have the original 2 messages, without summaryMsg
			const fullHistory = await store.history(session.id)
			expect(fullHistory).toHaveLength(2)
			expect(fullHistory[0]!.content).toBe("hello")
			expect(fullHistory[1]!.content).toEqual([{ type: "text", text: "world" }])
		} finally {
			await rm(path, { recursive: true, force: true })
		}
	})

	it("should fallback to active messages for history if history.jsonl does not exist", async () => {
		const { path, store } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")
			const msg1: Msg = { role: "user", content: "hello", ts: Date.now() }

			// Append only to active messages so that history.jsonl is not created
			await store.append(session.id, msg1, false)

			const history = await store.history(session.id)
			expect(history).toHaveLength(1)
			expect(history[0]!.content).toBe("hello")
		} finally {
			await rm(path, { recursive: true, force: true })
		}
	})

	it("should replace the entire active messages file atomically", async () => {
		const { path, store } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")
			const msg1: Msg = { role: "user", content: "hello", ts: Date.now() }
			const msg2: Msg = { role: "user", content: "world", ts: Date.now() + 1000 }

			await store.append(session.id, msg1)

			// Replace active messages with msg2 only
			await store.replaceMessages(session.id, [msg2])

			// Active messages should be completely replaced with msg2
			const activeMsgs = await store.messages(session.id)
			expect(activeMsgs).toHaveLength(1)
			expect(activeMsgs[0]!.content).toBe("world")

			// History should remain unchanged with original msg1
			const history = await store.history(session.id)
			expect(history).toHaveLength(1)
			expect(history[0]!.content).toBe("hello")
		} finally {
			await rm(path, { recursive: true, force: true })
		}
	})

	it("should delete a session", async () => {
		const { path, store } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")

			expect(await store.get(session.id)).not.toBeNull()
			const deleted = await store.delete(session.id)
			expect(deleted).toBe(true)
			expect(await store.get(session.id)).toBeNull()
		} finally {
			await rm(path, { recursive: true, force: true })
		}
	})

	it("should prune empty sessions but keep non-empty ones", async () => {
		const { path, store } = await createTempStore()
		try {
			// Create an empty session
			const emptySession = await store.create("/test/dir", "test-model", "test-provider")

			// Create a session with messages
			const activeSession = await store.create("/test/dir", "test-model", "test-provider")
			const msg: Msg = {
				role: "user",
				content: "hello",
				ts: Date.now(),
			}
			await store.append(activeSession.id, msg)

			// Both should exist initially
			expect(await store.get(emptySession.id)).not.toBeNull()
			expect(await store.get(activeSession.id)).not.toBeNull()

			// Run pruning
			await store.prune()

			// Empty session should be deleted
			expect(await store.get(emptySession.id)).toBeNull()

			// Active session should still exist
			expect(await store.get(activeSession.id)).not.toBeNull()
		} finally {
			await rm(path, { recursive: true, force: true })
		}
	})
})
