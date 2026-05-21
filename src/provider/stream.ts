import type { AgentEvent, ApiFormat, AssistantResult, StreamFn, StreamOpts } from "../types.ts"
import { streamGemini } from "./gemini.ts"
import { streamOpenAI } from "./openai.ts"

export type { AssistantResult, StreamEvent, StreamFn, StreamOpts } from "../types.ts"

/*
 * Push-based async event stream.
 *
 * Producers call push()/finish(). Consumers iterate with for-await-of.
 * Backpressure is implicit: push() resolves immediately; the iterator
 * awaits the next value only when the consumer asks for it.
 */
export class EventStream<T, R> {
	#events: T[] = []
	#done = false
	#result?: R
	#resolve?: (value: T) => void
	#doneResolve?: (value: R) => void
	#abort = false

	push(event: T): void {
		if (this.#abort) return
		// If a consumer is already waiting, deliver directly — skip the queue
		if (this.#resolve) {
			const resolve = this.#resolve
			this.#resolve = undefined
			resolve(event)
		} else {
			this.#events.push(event)
		}
	}

	finish(result: R): void {
		this.#done = true
		this.#result = result
		// Wake up a suspended iterator so it can see done=true and exit
		if (this.#resolve) {
			// undefined is a sentinel — the iterator loop checks done after waking
			this.#resolve(undefined as T)
		}
		if (this.#doneResolve) {
			this.#doneResolve(result)
		}
	}

	abort(): void {
		this.#abort = true
		this.#done = true
		if (this.#resolve) {
			this.#resolve(undefined as T)
		}
		if (this.#doneResolve) {
			this.#doneResolve(undefined as R)
		}
	}

	async *[Symbol.asyncIterator](): AsyncGenerator<T> {
		while (!this.#done || this.#events.length > 0) {
			if (this.#events.length > 0) {
				yield this.#events.shift() as T
				continue
			}
			if (this.#done) break
			const item = await new Promise<T | undefined>((resolve) => {
				this.#resolve = resolve as (value: T) => void
			})
			if (item !== undefined && this.#events.length === 0) {
				yield item
			} else if (this.#events.length > 0) {
				yield this.#events.shift() as T
			}
		}
	}

	get result(): R | undefined {
		return this.#result
	}

	get isDone(): boolean {
		return this.#done
	}
}

// Internal map of registered provider implementations
const registry = new Map<ApiFormat, StreamFn>([
	["openai", streamOpenAI],
	["gemini", streamGemini],
])

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
