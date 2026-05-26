import type { EventStream } from "../provider/stream.ts"
import type { AgentEvent, ApiFormat, LlmContext, LoopOpts, Model, Msg, Tool } from "../types.ts"
import { run } from "./loop.ts"

export class Agent {
	#api: ApiFormat
	#model: Model
	#system: string
	#messages: Msg[] = []
	#tools: Tool[]
	#apiKey: string
	#baseUrl: string

	constructor(opts: {
		api: ApiFormat
		model: Model
		apiKey: string
		baseUrl: string
		system: string
		tools: Tool[]
		messages?: Msg[]
	}) {
		this.#api = opts.api
		this.#model = opts.model
		this.#apiKey = opts.apiKey
		this.#baseUrl = opts.baseUrl
		this.#system = opts.system
		this.#tools = opts.tools
		this.#messages = opts.messages ?? []
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

	get apiKey(): string {
		return this.#apiKey
	}

	get baseUrl(): string {
		return this.#baseUrl
	}

	updateConfig(opts: { api: ApiFormat; model: Model; apiKey: string; baseUrl: string }): void {
		this.#api = opts.api
		this.#model = opts.model
		this.#apiKey = opts.apiKey
		this.#baseUrl = opts.baseUrl
	}

	setTools(tools: Tool[]): void {
		this.#tools = tools
	}

	setMessages(msgs: Msg[]): void {
		this.#messages = msgs
	}

	setModel(model: Model): void {
		this.#model = model
	}

	prompt(signal?: AbortSignal): EventStream<AgentEvent, Msg[]> {
		const context: LlmContext = {
			system: this.#system,
			messages: this.#messages,
			tools: this.#tools,
		}

		const opts: LoopOpts = {
			api: this.#api,
			model: this.#model,
			apiKey: this.#apiKey,
			baseUrl: this.#baseUrl,
		}

		return run(context, opts, signal)
	}
}
