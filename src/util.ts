import type { Msg, TextPart } from "./types.ts"

// ~4 chars per token for English/code. Close enough for capacity warnings.
export function estimateTokens(messages: Msg[]): number {
	let chars = 0
	for (const msg of messages) {
		if (typeof msg.content === "string") {
			chars += msg.content.length
		} else if (Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part.type === "text") chars += part.text.length
			}
		}
	}
	return Math.ceil(chars / 4)
}

export function textPart(s: string): TextPart {
	return { type: "text", text: s }
}
