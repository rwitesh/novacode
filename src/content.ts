import type { ToolResultOutput } from "@ai-sdk/provider-utils"
import type { ContentPart, TextPart, ToolResult } from "./types.ts"

export function textPart(s: string): TextPart {
	return { type: "text", text: s }
}

function partText(c: ContentPart): string {
	return c.type === "text" ? c.text : ""
}

// Single boundary between NovaCode tool results and AI SDK model output.
// Preserves images (read tool) and surfaces errors to the model.
export function toToolResultOutput(r: ToolResult): ToolResultOutput {
	if (r.isError) {
		return { type: "error-text", value: r.content.map(partText).join("\n") }
	}
	if (r.content.some((c) => c.type === "image")) {
		return {
			type: "content",
			value: r.content.map((c) =>
				c.type === "image"
					? { type: "media", data: c.data, mediaType: c.mime }
					: { type: "text", text: c.text },
			),
		}
	}
	return { type: "text", value: r.content.map(partText).join("\n") }
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
		case "content":
			return {
				text: output.value
					.map((p) => (p.type === "text" ? p.text : p.type === "media" ? "[image]" : ""))
					.join("\n"),
				isError: false,
			}
		default:
			return { text: "", isError: false }
	}
}
