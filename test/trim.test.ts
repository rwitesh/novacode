import type { ModelMessage } from "ai"
import { describe, expect, it } from "vitest"
import { trimMessages } from "../src/agent/trim.ts"

describe("trimMessages", () => {
	it("should return empty if messages is empty", () => {
		expect(trimMessages([], 100)).toEqual([])
	})

	it("should not trim if all messages fit in budget", () => {
		const messages: ModelMessage[] = [
			{ role: "user", content: "hello" },
			{ role: "assistant", content: "hi there" },
		]
		// Estimate is approx ceil((5+8)/4) = 4 tokens
		expect(trimMessages(messages, 10)).toEqual(messages)
	})

	it("should trim older turns if they exceed budget", () => {
		const messages: ModelMessage[] = [
			{ role: "user", content: "First turn query which is a bit long" }, // ~35 chars, ~9 tokens
			{ role: "assistant", content: "First response is here" }, // ~22 chars, ~6 tokens
			{ role: "user", content: "Second query" }, // ~12 chars, ~3 tokens
			{ role: "assistant", content: "Second response" }, // ~15 chars, ~4 tokens
		]

		// If budget is 8 tokens, it should only fit the second turn (~7 tokens)
		// and discard the first turn
		const trimmed = trimMessages(messages, 8)
		expect(trimmed).toEqual([
			{ role: "user", content: "Second query" },
			{ role: "assistant", content: "Second response" },
		])
	})

	it("should always preserve the compaction summary message", () => {
		const messages: ModelMessage[] = [
			{ role: "user", content: "[Prior context summary]\nThis is a summary of old history." }, // ~62 chars, ~16 tokens
			{ role: "user", content: "First query" }, // ~11 chars, ~3 tokens
			{ role: "assistant", content: "First response" }, // ~14 chars, ~4 tokens
			{ role: "user", content: "Second query" }, // ~12 chars, ~3 tokens
			{ role: "assistant", content: "Second response" }, // ~15 chars, ~4 tokens
		]

		// Budget is 25 tokens.
		// Summary is 16 tokens. Second turn is 7 tokens. Total = 23 tokens.
		// So it should keep the summary + Second turn, discarding the First turn.
		const trimmed = trimMessages(messages, 25)
		expect(trimmed).toEqual([
			{ role: "user", content: "[Prior context summary]\nThis is a summary of old history." },
			{ role: "user", content: "Second query" },
			{ role: "assistant", content: "Second response" },
		])
	})

	it("should retain the summary even if it's the only thing that fits", () => {
		const messages: ModelMessage[] = [
			{ role: "user", content: "[Prior context summary]\nShort summary" },
			{ role: "user", content: "First turn query is very long and goes over budget" },
			{ role: "assistant", content: "First response" },
		]

		const trimmed = trimMessages(messages, 15)
		expect(trimmed[0]).toEqual({ role: "user", content: "[Prior context summary]\nShort summary" })
	})
})
