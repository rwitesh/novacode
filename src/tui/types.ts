import type { ApprovalRequest } from "../types.ts"

export type TimelineEvent =
	| {
			id: string
			type: "SessionStarted"
			content: string
	  }
	| {
			id: string
			type: "UserMessage"
			content: string
	  }
	| {
			id: string
			type: "AssistantMessage"
			content: string
	  }
	| {
			id: string
			type: "ToolStarted"
			toolCallId: string
			toolName: string
			args: string
	  }
	| {
			id: string
			type: "ToolCompleted"
			toolCallId: string
			toolName: string
			args: string
			resultLineCount?: number
			resultMatchCount?: number
	  }
	| {
			id: string
			type: "ToolFailed"
			toolCallId: string
			toolName: string
			args: string
			error: string
	  }
	| {
			id: string
			type: "Thinking"
	  }
	| {
			id: string
			type: "Warning"
			content: string
	  }
	| {
			id: string
			type: "SystemMessage"
			content: string
	  }

export type PromptMode =
	| { type: "chat" }
	| {
			type: "select"
			message: string
			options: Array<{ value: string; label: string; hint?: string }>
			header?: string
			footer?: string
	  }
	| {
			type: "searchSelect"
			message: string
			options: Array<{ value: string; label: string; hint?: string }>
			header?: string
			footer?: string
	  }
	| {
			type: "password"
			message: string
			validate?: (v: string) => string | undefined
	  }
	| { type: "confirm"; message: string }
	| { type: "approval"; req: ApprovalRequest }

export interface ActiveTool {
	id: string
	name: string
	args: string
	status: "running" | "success" | "failure"
	error?: string
	lineCount?: number
	matchCount?: number
}
