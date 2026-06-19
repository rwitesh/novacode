/**
 * Shared type definitions for the entire project.
 *
 * AI message/tool/usage types are NOT redefined here — we use the AI SDK's
 * canonical types (`ModelMessage`, `ToolSet`, `LanguageModel`) directly from
 * `ai`, so there is a single message format across agent, persistence, and UI.
 *
 * What remains here is NovaCode-specific configuration, persistence, policy,
 * and CLI/TUI plumbing that has no AI SDK equivalent.
 */

/** Tool content (local shape used inside tool `execute` + converted to AI SDK parts) */

export interface TextPart {
	type: "text"
	text: string
}

export interface ImagePart {
	type: "image"
	data: string // base64
	mime: string
}

export type ContentPart = TextPart | ImagePart

export interface ToolResult {
	content: ContentPart[]
	isError: boolean
}

/** Token usage (mapped from AI SDK `LanguageModelUsage` for display) */

export interface Usage {
	in: number
	out: number
}

/** Provider & model catalog */

// Per-provider model entry, nested under ProviderDef. The provider id is
// implied by the parent, so it is not repeated on each entry. Only fields
// NovaCode actually consumes are stored (see src/config/catalog.ts):
//   contextWindow — compaction tail budget (compact.ts) + status display
//   reasoning     — gates the HIGH reasoning providerOption (providers.ts)
//   default       — marks the provider's default model
export interface ModelDef {
	id: string
	contextWindow: number
	reasoning: boolean
	default?: boolean
}

export interface ProviderDef {
	id: string
	name: string
	baseUrl: string
	envKey: string // env var name for API key
	models: ModelDef[]
}

// Resolved model with its provider id — runtime shape used across the app.
export interface Model extends ModelDef {
	provider: string
}

/** Config (settings.json + auth.json) */

export interface NovaConfig {
	provider: string
	model: string
}

export interface NovaAuth {
	apiKeys: Record<string, string> // provider -> key
}

/** Session persistence */

export interface Session {
	id: string
	cwd: string
	model: string
	provider: string
	title: string | null
	parentSessionId: string | null
	endReason: string | null
	created: number
	updated: number
	inputTokens: number
	outputTokens: number
	messageCount: number
}

export interface PendingSession {
	cwd: string
	model: string
	provider: string
	title: string | null
	parentSessionId: string | null
	created: number
}

export interface CompactResult {
	compacted: boolean
	summary?: string
	tokensBefore: number
	tokensAfter: number
	newSessionId?: string
}

/** Policy & permissions (approval is a separate concern from tool definitions) */

export type PermissionMode = "restricted" | "unrestricted"
export type ToolRisk = "safe" | "write" | "network" | "execution"

// Minimal contract a tool call exposes to the policy engine. Kept separate
// from AI SDK's ToolCallPart so the policy layer has no AI SDK dependency.
export interface PolicyCall {
	name: string
	args: Record<string, unknown>
}

export interface ApprovalRequest {
	tool: string
	risk: ToolRisk
	summary: string
	warning?: string
}

export interface PolicyApprover {
	request(req: ApprovalRequest): Promise<boolean>
}

/** Prompts — used by interactive commands within the TUI */

export interface Prompts {
	select(config: {
		message: string
		header?: string
		footer?: string
		options: Array<{ value: string; label: string; hint?: string }>
	}): Promise<string | null>
	searchSelect(config: {
		message: string
		header?: string
		footer?: string
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
