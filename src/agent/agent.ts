import type { EventStream } from "../eventStream.ts"
import type { PolicyEngine } from "../policy/engine.ts"
import type { AgentEvent, Effort, LlmContext, LoopOpts, Model, Msg, Tool } from "../types.ts"
import { run } from "./loop.ts"

export class Agent {
	#provider: string
	#model: Model
	#effort: Effort
	#system: string
	#messages: Msg[] = []
	#tools: Tool[]
	#apiKey: string
	#baseUrl: string
	#policy: PolicyEngine | null

	constructor(opts: {
		provider: string
		model: Model
		effort: Effort
		apiKey: string
		baseUrl: string
		system: string
		tools: Tool[]
		messages?: Msg[]
		policy?: PolicyEngine
	}) {
		this.#provider = opts.provider
		this.#model = opts.model
		this.#effort = opts.effort
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

	get effort(): Effort {
		return this.#effort
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
		provider: string
		model: Model
		effort: Effort
		apiKey: string
		baseUrl: string
	}): void {
		this.#provider = opts.provider
		this.#model = opts.model
		this.#effort = opts.effort
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

	setEffort(effort: Effort): void {
		this.#effort = effort
	}

	prompt(signal?: AbortSignal): EventStream<AgentEvent, Msg[]> {
		const context: LlmContext = {
			system: this.#system,
			messages: this.#messages,
			tools: this.#tools,
		}

		const policy = this.#policy
		const opts: LoopOpts = {
			provider: this.#provider,
			model: this.#model,
			effort: this.#effort,
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
