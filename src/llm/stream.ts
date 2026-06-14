import { EventStream } from "../eventStream.ts"
import type { AgentEvent, ApiFormat, AssistantResult, StreamFn, StreamOpts } from "../types.ts"
import { streamAnthropic } from "./anthropic.ts"
import { streamGemini } from "./gemini.ts"
import { streamOpenAI } from "./openai.ts"

export type { AssistantResult, StreamEvent, StreamFn, StreamOpts } from "../types.ts"

// Internal map of registered provider implementations
const registry = new Map<ApiFormat, StreamFn>([
	["openai", streamOpenAI],
	["gemini", streamGemini],
	["anthropic", streamAnthropic],
])

export function register(apiFormat: ApiFormat, fn: StreamFn): void {
	registry.set(apiFormat, fn)
}

// Bridges provider-specific StreamEvents into AgentEvents so the loop and TUI deal with one type.
export function stream(opts: StreamOpts): EventStream<AgentEvent, AssistantResult> {
	const fn = registry.get(opts.apiFormat)
	if (!fn) throw new Error(`No provider registered for API format: ${opts.apiFormat}`)

	const providerStream = fn(opts)
	const agentStream = new EventStream<AgentEvent, AssistantResult>()

	;(async () => {
		for await (const event of providerStream) {
			if (event.type === "text_delta") {
				agentStream.push({ type: "text_delta", text: event.text })
			} else if (event.type === "thinking_delta") {
				agentStream.push({ type: "thinking_delta", text: event.text })
			} else if (event.type === "retry") {
				agentStream.push({
					type: "retry",
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					delayMs: event.delayMs,
					reason: event.reason,
				})
			} else if (event.type === "tool_call") {
				agentStream.push({
					type: "tool_call",
					call: {
						type: "tool_call",
						id: event.call.id,
						name: event.call.name,
						args: event.call.args,
					},
				})
			} else if (event.type === "usage") {
				agentStream.push({ type: "usage", usage: event.usage })
			}
		}

		const res = providerStream.result
		if (res) {
			agentStream.finish(res)
		} else {
			// Fallback for unexpected closure
			agentStream.finish({ content: [], usage: { in: 0, out: 0 }, stop: "stop" })
		}
	})()

	return agentStream
}

export function getRegisteredApis(): ApiFormat[] {
	return [...registry.keys()]
}
