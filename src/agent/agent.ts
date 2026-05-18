import type { EventStream } from "../provider/stream.ts"
import type { AgentEvent, Model, Msg, Tool } from "../types.ts"
import { type LoopCtx, type LoopOpts, run } from "./loop.ts"

export class Agent {
	#model: Model
	#system: string
	#messages: Msg[] = []
	#tools: Tool[]
	#apiKey: string
	#baseUrl: string

	constructor(opts: {
		model: Model
		apiKey: string
		baseUrl: string
		system: string
		tools: Tool[]
	}) {
		this.#model = opts.model
		this.#apiKey = opts.apiKey
		this.#baseUrl = opts.baseUrl
		this.#system = opts.system
		this.#tools = opts.tools
	}

	get model(): Model {
		return this.#model
	}

	get messages(): Msg[] {
		return this.#messages
	}

	get tools(): Tool[] {
		return this.#tools
	}

	setTools(tools: Tool[]): void {
		this.#tools = tools
	}

	setModel(model: Model): void {
		this.#model = model
	}

	prompt(input: string, signal?: AbortSignal): EventStream<AgentEvent, Msg[]> {
		const ctx: LoopCtx = {
			system: this.#system,
			messages: this.#messages,
			tools: this.#tools,
		}

		const opts: LoopOpts = {
			model: this.#model,
			apiKey: this.#apiKey,
			baseUrl: this.#baseUrl,
		}

		const stream = run(input, ctx, opts, signal)

		// Update messages when done
		;(async () => {
			for await (const _event of stream) {
				// Events are consumed externally
			}
			const result = stream.result
			if (result) {
				this.#messages = [...result]
			}
		})()

		return stream
	}
}
