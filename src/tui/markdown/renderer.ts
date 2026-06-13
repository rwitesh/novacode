import chalk from "chalk"
import { formatRichText } from "./richText.ts"
import { highlightCode, isHighlightable } from "./syntax.ts"

export type FenceState = { inCodeBlock: boolean; codeBlockLang: string }

export class MarkdownRenderer {
	#inCodeBlock = false
	#codeBlockLang = ""

	constructor(seed?: FenceState) {
		if (seed) {
			this.#inCodeBlock = seed.inCodeBlock
			this.#codeBlockLang = seed.codeBlockLang
		}
	}

	getState(): FenceState {
		return {
			inCodeBlock: this.#inCodeBlock,
			codeBlockLang: this.#codeBlockLang,
		}
	}

	renderChunk(text: string): string {
		return text
			.split("\n")
			.map((line) => this.renderLine(line))
			.join("\n")
	}

	renderLine(line: string): string {
		const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/)
		if (fence) {
			if (this.#inCodeBlock) {
				this.#inCodeBlock = false
				return ""
			}
			this.#inCodeBlock = true
			this.#codeBlockLang = (fence[2] ?? "").trim()
			return this.#codeBlockLang ? chalk.gray(`─ ${this.#codeBlockLang}`) : ""
		}

		if (this.#inCodeBlock) {
			const lang = this.#codeBlockLang
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
