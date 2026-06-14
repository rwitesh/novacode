import type { EventStream } from "../eventStream.ts"
import type { PolicyEngine } from "../policy/engine.ts"
import type { AgentEvent, ApiFormat, LlmContext, LoopOpts, Model, Msg, Tool } from "../types.ts"
import { run } from "./loop.ts"

export class Agent {
	#apiFormat: ApiFormat
	#model: Model
	#system: string
	#messages: Msg[] = []
	#tools: Tool[]
	#apiKey: string
	#baseUrl: string
	#policy: PolicyEngine | null

	constructor(opts: {
		apiFormat: ApiFormat
		model: Model
		apiKey: string
		baseUrl: string
		system: string
		tools: Tool[]
		messages?: Msg[]
		policy?: PolicyEngine
	}) {
		this.#apiFormat = opts.apiFormat
		this.#model = opts.model
		this.#apiKey = opts.apiKey
		this.#baseUrl = opts.baseUrl
		this.#system = opts.system
		this.#tools = opts.tools
		this.#messages = opts.messages ?? []
		this.#policy = opts.policy ?? null
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

	get policy(): PolicyEngine | null {
		return this.#policy
	}

	updateConfig(opts: {
		apiFormat: ApiFormat
		model: Model
		apiKey: string
		baseUrl: string
	}): void {
		this.#apiFormat = opts.apiFormat
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

		const policy = this.#policy
		const opts: LoopOpts = {
			apiFormat: this.#apiFormat,
			model: this.#model,
			apiKey: this.#apiKey,
			baseUrl: this.#baseUrl,
			beforeTool: policy
				? async (call) => {
						const decision = await policy.check(call)
						return decision.allow
							? undefined
							: { block: true, reason: decision.reason ?? "Blocked by policy" }
					}
				: undefined,
		}

		return run(context, opts, signal)
	}
}
