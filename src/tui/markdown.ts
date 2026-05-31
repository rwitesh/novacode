import chalk from "chalk"

// biome-ignore lint/suspicious/noControlCharactersInRegex: standard ANSI escape sequence pattern
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

function getVisualLength(str: string): number {
	return str.replace(ANSI_REGEX, "").length
}

function formatInlineMarkdown(text: string): string {
	let formatted = text
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

export class MarkdownRenderer {
	#inCodeBlock = false
	#codeBlockLang = ""

	constructor(seed?: { inCodeBlock: boolean; codeBlockLang: string }) {
		if (seed) {
			this.#inCodeBlock = seed.inCodeBlock
			this.#codeBlockLang = seed.codeBlockLang
		}
	}

	getState() {
		return {
			inCodeBlock: this.#inCodeBlock,
			codeBlockLang: this.#codeBlockLang,
		}
	}

	renderChunk(text: string): string {
		const lines = text.split("\n")
		const renderedLines: string[] = []
		let currentTableLines: string[] = []
		let inCodeBlock = this.#inCodeBlock

		for (const line of lines) {
			const isCodeBlockDelimiter = line.startsWith("```")
			if (isCodeBlockDelimiter) {
				inCodeBlock = !inCodeBlock
			}

			if (!inCodeBlock && line.trim().startsWith("|")) {
				currentTableLines.push(line)
			} else {
				if (currentTableLines.length > 0) {
					renderedLines.push(this.renderTable(currentTableLines))
					currentTableLines = []
				}
				renderedLines.push(this.renderLine(line))
			}
		}

		if (currentTableLines.length > 0) {
			renderedLines.push(this.renderTable(currentTableLines))
		}

		return renderedLines.join("\n")
	}

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

		return formatInlineMarkdown(formatted)
	}

	renderTable(lines: string[]): string {
		const rows: string[][] = []
		let alignments: ("left" | "center" | "right")[] = []
		let hasDivider = false

		for (const line of lines) {
			const parts = line.split("|").map((p) => p.trim())
			const cells = parts.slice(1, parts.length - 1)

			const isDiv =
				cells.length > 0 &&
				cells.every((c) => /^[:\s-]*[-]{3,}[:\s-]*$/.test(c) || /^[:\s-]*[-]{1,2}[:\s-]*$/.test(c))
			if (isDiv) {
				hasDivider = true
				alignments = cells.map((c) => {
					const left = c.startsWith(":")
					const right = c.endsWith(":")
					if (left && right) return "center"
					if (right) return "right"
					return "left"
				})
			} else {
				rows.push(cells)
			}
		}

		if (rows.length === 0) return ""

		const numCols = Math.max(...rows.map((r) => r.length))
		if (numCols === 0) return ""

		while (alignments.length < numCols) {
			alignments.push("left")
		}

		const colWidths = Array(numCols).fill(0)
		const formattedRows = rows.map((row) =>
			Array(numCols)
				.fill(0)
				.map((_, idx) => {
					const cellText = row[idx] || ""
					const formattedText = formatInlineMarkdown(cellText)
					const visualLen = getVisualLength(formattedText)
					colWidths[idx] = Math.max(colWidths[idx], visualLen)
					return formattedText
				}),
		)

		const formatCell = (
			text: string,
			width: number,
			align: "left" | "center" | "right",
		): string => {
			const visualLen = getVisualLength(text)
			const diff = width - visualLen
			if (diff <= 0) return text
			if (align === "right") {
				return " ".repeat(diff) + text
			}
			if (align === "center") {
				const left = Math.floor(diff / 2)
				const right = diff - left
				return " ".repeat(left) + text + " ".repeat(right)
			}
			return text + " ".repeat(diff)
		}

		const borderStyle = {
			top: "─",
			topJoin: "┬",
			topLeft: "┌",
			topRight: "┐",
			mid: "─",
			midJoin: "┼",
			midLeft: "├",
			midRight: "┤",
			bottom: "─",
			bottomJoin: "┴",
			bottomLeft: "└",
			bottomRight: "┘",
			vertical: "│",
		}

		const output: string[] = []

		const topBorder =
			borderStyle.topLeft +
			colWidths.map((w) => borderStyle.top.repeat(w + 2)).join(borderStyle.topJoin) +
			borderStyle.topRight
		output.push(chalk.gray(topBorder))

		const headerCells = colWidths.map((w, idx) => {
			const cellText = formattedRows[0]?.[idx] || ""
			return formatCell(cellText, w, alignments[idx] || "left")
		})
		output.push(
			chalk.gray(borderStyle.vertical) +
				headerCells.map((c) => ` ${chalk.bold.blue(c)} `).join(chalk.gray(borderStyle.vertical)) +
				chalk.gray(borderStyle.vertical),
		)

		if (rows.length > 1 || hasDivider) {
			const midBorder =
				borderStyle.midLeft +
				colWidths.map((w) => borderStyle.mid.repeat(w + 2)).join(borderStyle.midJoin) +
				borderStyle.midRight
			output.push(chalk.gray(midBorder))
		}

		for (let rIdx = 1; rIdx < formattedRows.length; rIdx++) {
			const rowCells = colWidths.map((w, idx) => {
				const cellText = formattedRows[rIdx]?.[idx] || ""
				return formatCell(cellText, w, alignments[idx] || "left")
			})
			output.push(
				chalk.gray(borderStyle.vertical) +
					rowCells.map((c) => ` ${c} `).join(chalk.gray(borderStyle.vertical)) +
					chalk.gray(borderStyle.vertical),
			)
		}

		const bottomBorder =
			borderStyle.bottomLeft +
			colWidths.map((w) => borderStyle.bottom.repeat(w + 2)).join(borderStyle.bottomJoin) +
			borderStyle.bottomRight
		output.push(chalk.gray(bottomBorder))

		return output.join("\n")
	}
}

export function formatMarkdown(text: string): string {
	const renderer = new MarkdownRenderer()
	return renderer.renderChunk(text)
}

export class IncrementalMarkdownRenderer {
	#stableText = ""
	#stableOutput = ""
	#stableFenceState = { inCodeBlock: false, codeBlockLang: "" }
	#lastFullText = ""
	#lastFullOutput = ""

	update(fullText: string): string {
		if (fullText === this.#lastFullText) return this.#lastFullOutput

		if (this.#stableText && !fullText.startsWith(this.#stableText)) {
			this.#stableText = ""
			this.#stableOutput = ""
			this.#stableFenceState = { inCodeBlock: false, codeBlockLang: "" }
		}

		const boundary = findStableBoundary(fullText, this.#stableText.length, this.#stableFenceState)

		if (boundary > this.#stableText.length) {
			const newStable = fullText.slice(0, boundary)
			const chunk = this.#stableText ? newStable.slice(this.#stableText.length) : newStable
			const renderer = new MarkdownRenderer(this.#stableFenceState)
			this.#stableOutput += renderer.renderChunk(chunk)
			this.#stableText = newStable
			this.#stableFenceState = renderer.getState()
		}

		const unstable = fullText.slice(this.#stableText.length)
		const renderer = new MarkdownRenderer(this.#stableFenceState)
		const unstableOutput = unstable ? renderer.renderChunk(unstable) : ""

		this.#lastFullText = fullText
		this.#lastFullOutput = this.#stableOutput + unstableOutput
		return this.#lastFullOutput
	}

	reset(): void {
		this.#stableText = ""
		this.#stableOutput = ""
		this.#stableFenceState = { inCodeBlock: false, codeBlockLang: "" }
		this.#lastFullText = ""
		this.#lastFullOutput = ""
	}
}

function getFenceStateFromSeed(
	seed: { inCodeBlock: boolean; codeBlockLang: string },
	text: string,
): { inCodeBlock: boolean; codeBlockLang: string } {
	let inCodeBlock = seed.inCodeBlock
	let codeBlockLang = seed.codeBlockLang

	for (const line of text.split("\n")) {
		const trimmed = line.trim()
		if (/^(?:`{3,}|~{3,})/.test(trimmed)) {
			if (inCodeBlock) {
				inCodeBlock = false
				codeBlockLang = ""
			} else {
				inCodeBlock = true
				codeBlockLang = trimmed.slice(3).trim()
			}
		}
	}

	return { inCodeBlock, codeBlockLang }
}

function findStableBoundary(
	text: string,
	minIndex: number,
	stableFenceState: { inCodeBlock: boolean; codeBlockLang: string },
): number {
	let idx = text.length

	while (idx > minIndex) {
		const boundary = text.lastIndexOf("\n\n", idx - 1)
		if (boundary < minIndex) return minIndex

		const splitAt = boundary + 2
		const slice = text.slice(minIndex, splitAt)
		const state = getFenceStateFromSeed(stableFenceState, slice)
		if (!state.inCodeBlock) {
			return splitAt
		}
		idx = boundary
	}

	return minIndex
}
