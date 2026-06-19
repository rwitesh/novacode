import type { ModelMessage } from "ai"

// ~4 chars per token for English/code. Close enough for capacity warnings.
export function estimateTokens(messages: ModelMessage[]): number {
	let chars = 0
	for (const msg of messages) {
		const content = msg.content
		if (typeof content === "string") {
			chars += content.length
			continue
		}
		for (const part of content) {
			if (part.type === "text") chars += part.text.length
			else if (part.type === "tool-call") chars += JSON.stringify(part.input).length
			else if (part.type === "reasoning") chars += part.text.length
		}
	}
	return Math.ceil(chars / 4)
}
