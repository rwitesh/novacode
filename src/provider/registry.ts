/**
 * Registry for different model providers (OpenAI, Anthropic, etc.).
 * Provides a unified streaming interface for the agent loop.
 */
import type { AgentEvent, ApiFormat, Model, Msg, ToolDef, Usage } from "../types.ts"
import { EventStream } from "./stream.ts"

export type StreamFn = (opts: StreamOpts) => EventStream<StreamEvent, AssistantResult>

export interface StreamOpts {
	model: Model
	apiKey: string
	baseUrl: string
	system: string
	messages: Msg[]
	tools: ToolDef[]
	signal?: AbortSignal
}

export interface StreamEvent {
	type: "text_delta" | "thinking_delta" | "tool_call"
	text?: string
	call?: { id: string; name: string; args: Record<string, unknown> }
}

export interface AssistantResult {
	content: Array<{
		type: string
		text?: string
		id?: string
		name?: string
		args?: Record<string, unknown>
	}>
	usage: Usage
	stop: string
}

// Internal map of registered provider implementations
const registry = new Map<ApiFormat, StreamFn>()

export function register(api: ApiFormat, fn: StreamFn): void {
	registry.set(api, fn)
}

// Bridges provider-specific StreamEvents into AgentEvents so the loop and TUI deal with one type.
export function stream(opts: StreamOpts): EventStream<AgentEvent, Msg[]> {
	const fn = registry.get(opts.model.provider as ApiFormat)
	if (!fn) throw new Error(`No provider registered for: ${opts.model.provider}`)

	// Bridge layer: converts provider-specific StreamEvents into the agent's
	// AgentEvent shape, so the loop and TUI only deal with one event type.
	const providerStream = fn(opts)
	const agentStream = new EventStream<AgentEvent, Msg[]>()

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
			}
		}
		agentStream.finish([])
	})()

	return agentStream
}

export function getRegisteredApis(): ApiFormat[] {
	return [...registry.keys()]
}
