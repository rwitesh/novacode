import { describe, expect, it } from "bun:test"
import { SessionStore } from "../src/session/store.ts"
import type { Msg } from "../src/types.ts"

describe("SessionStore", () => {
	it("should create and get a session", () => {
		const store = new SessionStore(":memory:")
		const session = store.create("/test/dir", "test-model", "test-provider")

		expect(session.id).toBeString()
		expect(session.cwd).toBe("/test/dir")
		expect(session.model).toBe("test-model")
		expect(session.provider).toBe("test-provider")
		expect(session.title).toBeNull()

		const fetched = store.get(session.id)
		expect(fetched).not.toBeNull()
		expect(fetched?.id).toBe(session.id)
		expect(fetched?.cwd).toBe(session.cwd)
	})

	it("should append and retrieve messages", () => {
		const store = new SessionStore(":memory:")
		const session = store.create("/test/dir", "test-model", "test-provider")

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

		store.append(session.id, msg1)
		store.append(session.id, msg2)

		const msgs = store.messages(session.id)
		expect(msgs).toHaveLength(2)
		expect(msgs[0]!.role).toBe("user")
		expect(msgs[1]!.role).toBe("assistant")
		expect(store.messageCount(session.id)).toBe(2)
	})

	it("should delete a session", () => {
		const store = new SessionStore(":memory:")
		const session = store.create("/test/dir", "test-model", "test-provider")

		expect(store.get(session.id)).not.toBeNull()
		const deleted = store.delete(session.id)
		expect(deleted).toBeTrue()
		expect(store.get(session.id)).toBeNull()
	})
})
