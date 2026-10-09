import chalk from "chalk"
import { sanitizeText } from "../helpers.ts"
import { formatRichText } from "./richText.ts"
import { highlightCode, isHighlightable } from "./syntax.ts"

export type FenceState = {
	inCodeBlock: boolean
	codeBlockLang: string
	marker: string
	length: number
}

export const EMPTY_FENCE: FenceState = {
	inCodeBlock: false,
	codeBlockLang: "",
	marker: "",
	length: 0,
}

export function parseFence(line: string, state: FenceState): FenceState | null {
	const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
	if (!match?.[1]) return null
	const marker = match[1][0] ?? ""
	const suffix = (match[2] ?? "").trim()
	if (state.inCodeBlock) {
		return marker === state.marker && match[1].length >= state.length && !suffix
			? EMPTY_FENCE
			: null
	}
	if (marker === "`" && suffix.includes("`")) return null
	return { inCodeBlock: true, codeBlockLang: suffix, marker, length: match[1].length }
}

export class MarkdownRenderer {
	#state = EMPTY_FENCE

	constructor(seed?: FenceState) {
		if (seed) this.#state = { ...seed }
	}

	getState(): FenceState {
		return { ...this.#state }
	}

	renderChunk(text: string): string {
		const safe = sanitizeText(text)
		const lines = safe.split("\n")
		const trailingNewline = safe.endsWith("\n")
		if (trailingNewline) lines.pop()
		return lines.map((line) => this.renderLine(line)).join("\n") + (trailingNewline ? "\n" : "")
	}

	renderLine(line: string): string {
		const fence = parseFence(line, this.#state)
		if (fence) {
			this.#state = fence
			return fence.codeBlockLang ? chalk.gray(`─ ${fence.codeBlockLang}`) : ""
		}

		if (this.#state.inCodeBlock) {
			const lang = this.#state.codeBlockLang
			const code = isHighlightable(lang) ? highlightCode(line, lang) : chalk.dim(line)
			return `  ${code}`
		}

		if (line.startsWith("#")) {
			const match = line.match(/^(#{1,6})\s+(.*)$/)
			if (match?.[1] && match[2]) {
				const level = match[1].length
				const content = match[2]
				if (level === 1) return chalk.bold.magenta.underline(content)
				if (level === 2) return chalk.bold.blue(content)
				return chalk.bold.cyan(content)
			}
		}

		let formatted = line
		if (formatted.startsWith("- ") || formatted.startsWith("* ")) {
			formatted = `  ${chalk.yellow("•")} ${formatted.slice(2)}`
		}

		return formatRichText(formatted)
	}
}

export function formatMarkdown(text: string): string {
	return new MarkdownRenderer().renderChunk(text)
}
