/**
 * Stateful agent wrapper around AI SDK streamText.
 *
 * Holds mutable conversation state (canonical `ModelMessage[]`), the active
 * model/provider config, tools, and the policy engine. `prompt()` calls
 * streamText directly with a no-op onError to suppress the default console.error
 * that dumps full RetryError/APICallError objects to stderr.
 */
import type { ModelMessage, OnStepFinishEvent, ToolSet } from "ai"
import { stepCountIs, streamText } from "ai"
import type { PolicyEngine } from "../policy/engine.ts"
import { createModel, reasoningOpts } from "../providers.ts"
import { estimateTokens } from "../tokens.ts"
import type { Model } from "../types.ts"
import { withApproval } from "./approval.ts"
import { preparePrompt } from "./prompt.ts"
import { trimMessages } from "./trim.ts"

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

	get system(): string {
		return this.#system
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

	async prompt(signal?: AbortSignal, onStepFinish?: StepFinishHandler) {
		const systemTokens = estimateTokens(this.#system)
		const maxInputTokens = this.#model.contextWindow - systemTokens - 4096
		const trimmed = trimMessages(this.#messages, maxInputTokens)

		const { instructions, messages: messagesToStream } = preparePrompt(this.#system, trimmed)

		return streamText({
			model: createModel(this.#provider, this.#model.id, this.#apiKey),
			system: instructions,
			tools: withApproval(this.#tools, this.#policy),
			stopWhen: stepCountIs(MAX_TURNS),
			providerOptions: this.#model.reasoning ? reasoningOpts(this.#provider) : undefined,
			messages: messagesToStream,
			abortSignal: signal,
			onStepFinish,
			onError: () => undefined,
		})
	}
}
