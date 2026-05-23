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

	it("should support compaction", async () => {
		const { path, store } = await createTempStore()
		try {
			const session = await store.create("/test/dir", "test-model", "test-provider")
			await store.saveCompaction(session.id, "summary", ["read.txt"], ["write.txt"], 5)

			const compaction = await store.getLatestCompaction(session.id)
			expect(compaction).not.toBeNull()
			expect(compaction?.summary).toBe("summary")
			expect(compaction?.seqBefore).toBe(5)
			expect(compaction?.filesRead).toEqual(["read.txt"])
			expect(compaction?.filesWrote).toEqual(["write.txt"])
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
