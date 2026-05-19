/**
 * Registry for different model providers (OpenAI, Anthropic, etc.).
 * Provides a unified streaming interface for the agent loop.
 */
import type { AgentEvent, ApiFormat, AssistantResult, StreamFn, StreamOpts } from "../types.ts"
import { EventStream } from "./stream.ts"

export type { AssistantResult, StreamEvent, StreamFn, StreamOpts } from "../types.ts"

// Internal map of registered provider implementations
const registry = new Map<ApiFormat, StreamFn>()

export function register(api: ApiFormat, fn: StreamFn): void {
	registry.set(api, fn)
}

// Bridges provider-specific StreamEvents into AgentEvents so the loop and TUI deal with one type.
export function stream(opts: StreamOpts): EventStream<AgentEvent, AssistantResult> {
	const fn = registry.get(opts.api)
	if (!fn) throw new Error(`No provider registered for API format: ${opts.api}`)

	// Bridge layer: converts provider-specific StreamEvents into the agent's
	// AgentEvent shape, so the loop and TUI only deal with one event type.
	const providerStream = fn(opts)
	const agentStream = new EventStream<AgentEvent, AssistantResult>()

	;(async () => {
		for await (const event of providerStream) {
			if (event.type === "text_delta") {
				agentStream.push({ type: "text_delta", text: event.text ?? "" })
			} else if (event.type === "thinking_delta") {
				agentStream.push({ type: "thinking_delta", text: event.text ?? "" })
			} else if (event.type === "tool_call" && event.call) {
				agentStream.push({
					type: "tool_call",
					call: {
						type: "tool_call",
						id: event.call.id,
						name: event.call.name,
						args: event.call.args,
					},
				})
			} else if (event.type === "usage" && event.usage) {
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
