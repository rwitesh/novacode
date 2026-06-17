import { EventStream } from "../eventStream.ts"
import type { AgentEvent, AssistantResult, Effort, ProviderStream, StreamOpts } from "../types.ts"
import { anthropicProvider } from "./anthropic.ts"
import { deepseekProvider } from "./deepseek.ts"
import { geminiProvider } from "./gemini.ts"
import { glmProvider } from "./glm.ts"
import { openaiProvider } from "./openai.ts"

export type { AssistantResult, StreamEvent, StreamFn, StreamOpts } from "../types.ts"

const registry = new Map<string, ProviderStream>([
	[glmProvider.id, glmProvider],
	[geminiProvider.id, geminiProvider],
	[deepseekProvider.id, deepseekProvider],
	[openaiProvider.id, openaiProvider],
	[anthropicProvider.id, anthropicProvider],
])

export function register(stream: ProviderStream): void {
	registry.set(stream.id, stream)
}

export function getEfforts(id: string): Effort[] {
	return registry.get(id)?.efforts.options ?? []
}

export function resolveEffort(providerId: string, effort?: Effort): Effort {
	const p = registry.get(providerId)
	if (!p) return "high"
	if (effort && p.efforts.options.includes(effort)) return effort
	return p.efforts.default
}

export function stream(opts: StreamOpts): EventStream<AgentEvent, AssistantResult> {
	const provider = registry.get(opts.provider)
	if (!provider) throw new Error(`No provider registered for provider id: ${opts.provider}`)

	const providerStream = provider.stream(opts)
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
			agentStream.finish({ content: [], usage: { in: 0, out: 0 }, stop: "stop" })
		}
	})()

	return agentStream
}
