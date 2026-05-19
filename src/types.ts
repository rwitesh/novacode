/**
 * Shared type definitions for the entire project.
 * Includes messaging, tools, providers, and agent loop events.
 */
/** Content Parts */

export interface TextPart {
	type: "text"
	text: string
}

export interface ImagePart {
	type: "image"
	data: string // base64
	mime: string
}

export interface ThinkPart {
	type: "thinking"
	text: string
}

export interface ToolCallPart {
	type: "tool_call"
	id: string
	name: string
	args: Record<string, unknown>
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
	| { type: "tool_result"; callId: string; result: ToolResultMsg }
	| { type: "turn_end"; msg: AssistantMsg; results: ToolResultMsg[] }
	| { type: "done"; stop: StopReason }

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
