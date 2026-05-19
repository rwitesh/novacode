import { describe, expect, it } from "bun:test"
import { run } from "../src/agent/loop.ts"
import type { AssistantResult, StreamEvent } from "../src/provider/registry.ts"
import { register } from "../src/provider/registry.ts"
import { EventStream } from "../src/provider/stream.ts"
import type { AgentEvent, ApiFormat, Msg, Tool } from "../src/types.ts"

// Use a unique api format to avoid clashing with real providers
const MOCK_API = "mock_test" as const

function mockProvider(responses: AssistantResult[]) {
	let idx = 0
	const fn = () => {
		const es = new EventStream<StreamEvent, AssistantResult>()
		queueMicrotask(() => {
			const res = responses[idx] ?? responses[responses.length - 1]
			idx++
			if (!res) {
				es.finish({ content: [], usage: { in: 0, out: 0 }, stop: "stop" })
				return
			}
			for (const c of res.content) {
				if (c.type === "text" && c.text) {
					es.push({ type: "text_delta", text: c.text })
				}
				if (c.type === "tool_call" && c.id && c.name) {
					es.push({
						type: "tool_call",
						call: {
							type: "tool_call",
							id: c.id,
							name: c.name,
							args: (c.args as Record<string, unknown>) ?? {},
						},
					})
				}
			}
			es.finish(res)
		})
		return es
	}
	// biome-ignore lint/suspicious/noExplicitAny: test mock needs type coercion
	register(MOCK_API as any, fn as any)
}

const fakeModel = {
	id: "test",
	name: "Test",
	provider: MOCK_API,
	contextWindow: 1000,
	maxTokens: 100,
	supportsThinking: false,
}

const noopTool: Tool = {
	def: {
		name: "noop",
		description: "does nothing",
		parameters: { type: "object", properties: {} },
	},
	execute: async () => ({
		content: [{ type: "text" as const, text: "done" }],
		isError: false,
	}),
}

function makeTextResult(text: string): AssistantResult {
	return {
		content: [{ type: "text", text }],
		usage: { in: 0, out: 0 },
		stop: "stop",
	}
}

function makeToolCallResult(
	id: string,
	name: string,
	args: Record<string, unknown> = {},
): AssistantResult {
	return {
		content: [{ type: "tool_call", id, name, args }],
		usage: { in: 0, out: 0 },
		stop: "tool_use",
	}
}

describe("agent loop", () => {
	it("respects max turns limit", async () => {
		mockProvider(Array(100).fill(makeToolCallResult("1", "noop")))

		const ctx = { system: "", messages: [] as Msg[], tools: [noopTool] }
		const opts = {
			api: MOCK_API as unknown as ApiFormat,
			model: fakeModel,
			apiKey: "test",
			baseUrl: "http://test",
			maxTurns: 3,
		}

		const events: AgentEvent[] = []
		const stream = run("test", ctx, opts)
		for await (const ev of stream) {
			events.push(ev)
		}

		const turnEvents = events.filter((e) => e.type === "turn")
		expect(turnEvents.length).toBeLessThanOrEqual(3)
	})

	it("emits warning when approaching context limit", async () => {
		mockProvider([makeTextResult("ok")])

		const bigContent = "x".repeat(3600) // ~900 tokens, >90% of 1000
		const ctx = {
			system: "",
			messages: [{ role: "user" as const, content: bigContent, ts: Date.now() }] as Msg[],
			tools: [noopTool],
		}
		const opts = {
			api: MOCK_API as unknown as ApiFormat,
			model: fakeModel,
			apiKey: "test",
			baseUrl: "http://test",
			maxTurns: 1,
		}

		const events: AgentEvent[] = []
		const stream = run("test", ctx, opts)
		for await (const ev of stream) {
			events.push(ev)
		}

		const warnings = events.filter(
			(e) => e.type === "text_delta" && e.text.includes("context limit"),
		)
		expect(warnings.length).toBeGreaterThanOrEqual(1)
	})

	it("emits done event on completion", async () => {
		mockProvider([makeTextResult("hello")])

		const ctx = { system: "", messages: [] as Msg[], tools: [] }
		const opts = {
			api: MOCK_API as unknown as ApiFormat,
			model: fakeModel,
			apiKey: "test",
			baseUrl: "http://test",
		}

		const events: AgentEvent[] = []
		const stream = run("test", ctx, opts)
		for await (const ev of stream) {
			events.push(ev)
		}

		const done = events.find((e) => e.type === "done")
		expect(done).toBeDefined()
		if (done && done.type === "done") {
			expect(done.stop).toBe("stop")
		}
	})
})
