import type { ModelMessage } from "ai"
import { describe, expect, it, vi } from "vitest"
import { Agent } from "../src/agent/agent.ts"

vi.mock("ai", async (importOriginal) => {
	const actual = await importOriginal<typeof import("ai")>()
	return {
		...actual,
		ToolLoopAgent: class {
			public options: unknown
			constructor(options: unknown) {
				this.options = options
			}
			stream(args: {
				messages: ModelMessage[]
				abortSignal?: AbortSignal
				onStepFinish?: unknown
			}) {
				return {
					...args,
					fullStream: [],
					response: Promise.resolve({ messages: [] }),
					instructions: (this.options as { instructions: string }).instructions,
				}
			}
		},
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
