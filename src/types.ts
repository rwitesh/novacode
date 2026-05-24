/**
 * Shared type definitions for the entire project.
 * Includes messaging, tools, providers, and agent loop events.
 */
/** Content Parts */

export interface TextPart {
	type: "text"
	text: string
	signature?: string
}

export interface ImagePart {
	type: "image"
	data: string // base64
	mime: string
}

export interface ThinkPart {
	type: "thinking"
	text: string
	signature?: string
}

export interface ToolCallPart {
	type: "tool_call"
	id: string
	name: string
	args: Record<string, unknown>
	signature?: string
}

export type ContentPart = TextPart | ImagePart | ThinkPart | ToolCallPart

/** Messages */

export interface UserMsg {
	role: "user"
	content: string | ContentPart[]
	ts: number
}

export interface AssistantMsg {
	role: "assistant"
	content: ContentPart[]
	model: string
	provider: string
	usage: Usage
	stop: StopReason
	error?: string
	ts: number
}

export interface ToolResultMsg {
	role: "tool_result"
	callId: string
	tool: string
	args?: Record<string, unknown>
	content: ContentPart[]
	isError: boolean
	ts: number
}

export type Msg = UserMsg | AssistantMsg | ToolResultMsg
export type StopReason = "stop" | "length" | "tool_use" | "error" | "aborted"

/** Usage */

export interface Usage {
	in: number
	out: number
	cacheRead?: number
	cacheWrite?: number
}

/** Provider */

export type ApiFormat = "openai" | "gemini"

export interface ProviderDef {
	id: string
	name: string
	api: ApiFormat
	baseUrl: string
	envKey: string // env var name for API key
}

export interface Model {
	id: string
	name: string
	provider: string
	contextWindow: number
	maxTokens: number
	supportsThinking: boolean
}

/** Tools */

export interface ToolDef {
	name: string
	description: string
	parameters: ToolParamDef
}

export interface ToolParamDef {
	type: "object"
	properties: Record<string, ToolPropDef>
	required?: string[]
}

export interface ToolPropDef {
	type: string
	description?: string
	enum?: string[]
	items?: ToolPropDef
	properties?: Record<string, ToolPropDef>
	required?: string[]
}

export interface ToolResult {
	content: ContentPart[]
	isError: boolean
}

export type ToolExecuteFn = (
	args: Record<string, unknown>,
	signal?: AbortSignal,
) => Promise<ToolResult>

export interface Tool {
	def: ToolDef
	execute: ToolExecuteFn
}

/** Agent Events */

export type AgentEvent =
	| { type: "start" }
	| { type: "turn" }
	| { type: "text_delta"; text: string }
	| { type: "thinking_delta"; text: string }
	| { type: "tool_call"; call: ToolCallPart }
	| { type: "assistant_msg"; msg: AssistantMsg }
	| { type: "tool_result"; callId: string; result: ToolResultMsg; args?: Record<string, unknown> }
	| { type: "turn_end"; msg: AssistantMsg; results: ToolResultMsg[] }
	| { type: "usage"; usage: Usage }

/** Config */

export interface NovaConfig {
	provider: string
	model: string
}

export interface NovaAuth {
	apiKeys: Record<string, string> // provider -> key
}

/** Session */

export interface Session {
	id: string
	cwd: string
	model: string
	provider: string
	title: string | null
	created: number
	updated: number
}

export interface Compaction {
	summary: string
	seqBefore: number
	filesRead: string[]
	filesWrote: string[]
	ts: number
}

export interface CompactResult {
	compacted: boolean
	summary?: string
	msgsRemoved: number
}

/** Loop & Provider Types */

export interface LoopCtx {
	system: string
	messages: Msg[]
	tools: Tool[]
}

export interface LoopOpts {
	api: ApiFormat
	model: Model
	apiKey: string
	baseUrl: string
	maxTurns?: number
	// Intercept tool calls before they execute
	beforeTool?: (
		call: ToolCallPart,
		args: Record<string, unknown>,
		ctx: LoopCtx,
	) => Promise<{ block?: boolean; reason?: string } | undefined>
	// Run logic after a tool completes
	afterTool?: (call: ToolCallPart, result: ToolResultMsg, ctx: LoopCtx) => Promise<void>
}

export interface StreamOpts {
	api: ApiFormat
	model: Model
	apiKey: string
	baseUrl: string
	system: string
	messages: Msg[]
	tools: ToolDef[]
	signal?: AbortSignal
}

export interface IEventStream<T, R> {
	[Symbol.asyncIterator](): AsyncGenerator<T>
	result: R | undefined
	isDone: boolean
}

export type StreamFn = (opts: StreamOpts) => IEventStream<StreamEvent, AssistantResult>

export interface StreamEvent {
	type: "text_delta" | "thinking_delta" | "tool_call" | "usage"
	text?: string
	call?: ToolCallPart
	usage?: Usage
}

export interface AssistantResult {
	content: ContentPart[]
	usage: Usage
	stop: StopReason
}

/** Prompts — used by interactive commands within the TUI */

export interface Prompts {
	select(config: {
		message: string
		header?: string
		options: Array<{ value: string; label: string; hint?: string }>
	}): Promise<string | null>
	password(config: {
		message: string
		validate?: (v: string) => string | undefined
	}): Promise<string | null>
	confirm(config: { message: string }): Promise<boolean | null>
}

/** Skills */

export interface Skill {
	name: string
	description: string
	path: string
	source: "global" | "project"
}

/** Commands */

export interface Cmd {
	name: string
	desc: string
	aliases?: string[]
}
