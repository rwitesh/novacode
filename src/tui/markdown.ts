import chalk from "chalk"

export class MarkdownRenderer {
	#inCodeBlock = false
	#codeBlockLang = ""

	renderLine(line: string): string {
		if (line.startsWith("```")) {
			if (this.#inCodeBlock) {
				this.#inCodeBlock = false
				return chalk.dim(`└${"─".repeat(50)}`)
			}
			this.#inCodeBlock = true
			this.#codeBlockLang = line.slice(3).trim()
			return chalk.dim(
				"┌" +
					"─".repeat(10) +
					` [Code: ${this.#codeBlockLang || "text"}] ` +
					"─".repeat(40 - (this.#codeBlockLang?.length || 4)),
			)
		}

		if (this.#inCodeBlock) {
			return chalk.cyan(`│  ${line}`)
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

		formatted = formatted.replace(/`([^`]+)`/g, (_, code) => chalk.yellow(code))
		formatted = formatted.replace(/\*\*([^*]+)\*\*/g, (_, bold) => chalk.bold(bold))
		formatted = formatted.replace(/__([^_]+)__/g, (_, bold) => chalk.bold(bold))
		formatted = formatted.replace(/\*([^*]+)\*/g, (_, italic) => chalk.italic(italic))
		formatted = formatted.replace(/_([^_]+)_/g, (_, italic) => chalk.italic(italic))
		formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
			return `${chalk.blue(text)} ${chalk.dim(`(${url})`)}`
		})

		return formatted
	}
}

export function formatMarkdown(text: string): string {
	const renderer = new MarkdownRenderer()
	return text
		.split("\n")
		.map((line) => renderer.renderLine(line))
		.join("\n")
}
