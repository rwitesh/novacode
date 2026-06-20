import type { ModelMessage } from "ai"
import { describe, expect, it, vi } from "vitest"
import { Agent } from "../src/agent/agent.ts"
import { estimateTokens } from "../src/tokens.ts"

vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>()
	return {
		...actual,
		streamText: vi.fn((args: { messages: ModelMessage[] }) => ({
			fullStream: [],
			messages: args.messages,
			response: Promise.resolve({ messages: args.messages }),
		})),
	}
})

vi.mock("../src/providers.ts", () => ({
	createModel: vi.fn().mockReturnValue({}),
	reasoningOpts: vi.fn(),
}))

describe("Agent message trimming", () => {
	it("should trim messages in-memory during prompt() without mutating the agent's messages", async () => {
		const mockModel = {
			id: "mock-model",
			name: "Mock Model",
			provider: "mock-provider",
			contextWindow: 10000,
			reasoning: false,
		}

		// A very long message that will exceed the max input tokens budget (approx 5894 tokens).
		const longMessage = "a".repeat(25000)

		const messages: ModelMessage[] = [
			{ role: "user", content: `Very long query ${longMessage}` },
			{ role: "assistant", content: "Response" },
			{ role: "user", content: "Active query" },
		]

		const agent = new Agent({
			provider: "mock-provider",
			model: mockModel,
			apiKey: "mock-key",
			system: "System prompt instructions.",
			tools: {},
			messages,
		})

		const streamResult = (await agent.prompt()) as unknown as { messages: ModelMessage[] }

		// Verify the stream received a trimmed list containing only the active query.
		expect(streamResult.messages).toBeDefined()
		expect(streamResult.messages).toHaveLength(1)
		expect(streamResult.messages[0]).toEqual({ role: "user", content: "Active query" })

		// Verify the agent's internal messages list remains fully intact.
		expect(agent.messages).toHaveLength(3)
		expect(agent.messages[0]?.content).toContain("Very long query")
	})
})

describe("estimateTokens consolidation", () => {
	it("should estimate tokens for a string correctly (chars / 4)", () => {
		expect(estimateTokens("abcd")).toBe(1)
		expect(estimateTokens("abcde")).toBe(2)
		expect(estimateTokens("")).toBe(0)
	})

	it("should estimate tokens for ModelMessage[] correctly", () => {
		const messages: ModelMessage[] = [
			{ role: "user", content: "abcd" },
			{ role: "assistant", content: "efgh" },
		]
		expect(estimateTokens(messages)).toBe(2)
	})
})
