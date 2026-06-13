import { type FenceState, MarkdownRenderer } from "./renderer.ts"

export class StreamingMarkdownRenderer {
	#stableText = ""
	#stableOutput = ""
	#stableFenceState: FenceState = { inCodeBlock: false, codeBlockLang: "" }
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

function getFenceStateFromSeed(seed: FenceState, text: string): FenceState {
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

function findStableBoundary(text: string, minIndex: number, stableFenceState: FenceState): number {
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
