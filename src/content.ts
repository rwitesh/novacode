import type { ToolResultOutput } from "@ai-sdk/provider-utils"
import type { ToolResult } from "./types.ts"

// Single boundary between NovaCode tool results and AI SDK model output.
// Surfaces errors to the model as error-text so the loop continues.
export function toToolResultOutput(r: ToolResult): ToolResultOutput {
	const value = r.content.join("\n")
	return r.isError ? { type: "error-text", value } : { type: "text", value }
}

// Flatten an AI SDK tool-result output back to display text + error flag (for the TUI).
export function summarizeToolOutput(output: ToolResultOutput): { text: string; isError: boolean } {
	switch (output.type) {
		case "text":
			return { text: output.value, isError: false }
		case "error-text":
			return { text: output.value, isError: true }
		case "error-json":
			return { text: JSON.stringify(output.value), isError: true }
		case "execution-denied":
			return { text: output.reason ?? "execution denied", isError: true }
		case "json":
			return { text: JSON.stringify(output.value), isError: false }
		default:
			return { text: "", isError: false }
	}
}
