/**
 * Stateful agent wrapper around an AI SDK ToolLoopAgent.
 *
 * Holds mutable conversation state (canonical `ModelMessage[]`), the active
 * model/provider config, tools, and the policy engine. `prompt()` builds a
 * ToolLoopAgent per turn (model/tools/providerOptions may change at runtime)
 * and returns its streaming result for the TUI to consume.
 */
import type { ModelMessage, OnStepFinishEvent, ToolSet } from "ai"
import { stepCountIs, ToolLoopAgent } from "ai"
import type { PolicyEngine } from "../policy/engine.ts"
import { createModel, reasoningOpts } from "../providers.ts"
import type { Model } from "../types.ts"
import { withApproval } from "./approval.ts"

// Safety cap so a misbehaving model can't loop forever
const MAX_TURNS = 50

export type StepFinishHandler = (event: OnStepFinishEvent<ToolSet>) => void | Promise<void>

export class Agent {
	#provider: string
	#model: Model
	#system: string
	#messages: ModelMessage[] = []
	#tools: ToolSet
	#apiKey: string
	#policy: PolicyEngine | null

	constructor(opts: {
		provider: string
		model: Model
		apiKey: string
		system: string
		tools: ToolSet
		messages?: ModelMessage[]
		policy?: PolicyEngine
	}) {
		this.#provider = opts.provider
		this.#model = opts.model
		this.#apiKey = opts.apiKey
		this.#system = opts.system
		this.#tools = opts.tools
		this.#messages = opts.messages ?? []
		this.#policy = opts.policy ?? null
	}

	get model(): Model {
		return this.#model
	}

	get messages(): ModelMessage[] {
		return this.#messages
	}

	get tools(): ToolSet {
		return this.#tools
	}

	get apiKey(): string {
		return this.#apiKey
	}

	get policy(): PolicyEngine | null {
		return this.#policy
	}

	updateConfig(opts: { provider: string; model: Model; apiKey: string }): void {
		this.#provider = opts.provider
		this.#model = opts.model
		this.#apiKey = opts.apiKey
	}

	setTools(tools: ToolSet): void {
		this.#tools = tools
	}

	setMessages(msgs: ModelMessage[]): void {
		this.#messages = msgs
	}

	appendMessages(msgs: ModelMessage[]): void {
		this.#messages = [...this.#messages, ...msgs]
	}

	setModel(model: Model): void {
		this.#model = model
	}

	async prompt(
		signal?: AbortSignal,
		onStepFinish?: StepFinishHandler,
	): Promise<Awaited<ReturnType<ToolLoopAgent["stream"]>>> {
		const agent = new ToolLoopAgent({
			model: createModel(this.#provider, this.#model.id, this.#apiKey),
			instructions: this.#system,
			tools: withApproval(this.#tools, this.#policy),
			stopWhen: stepCountIs(MAX_TURNS),
			providerOptions: this.#model.reasoning ? reasoningOpts(this.#provider) : undefined,
		})

		return agent.stream({ messages: this.#messages, abortSignal: signal, onStepFinish })
	}
}
