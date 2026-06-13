import type { TextPart } from "./types.ts"

export function textPart(s: string): TextPart {
	return { type: "text", text: s }
}
