import { sanitizeText } from "../helpers.ts"
import { EMPTY_FENCE, type FenceState, MarkdownRenderer, parseFence } from "./renderer.ts"

export class StreamingMarkdownRenderer {
	#stableText = ""
	#stableOutput = ""
	#stableFenceState: FenceState = EMPTY_FENCE
	#lastFullText = ""
	#lastFullOutput = ""

	update(text: string): string {
		const fullText = sanitizeText(text)
		if (fullText === this.#lastFullText) return this.#lastFullOutput

		if (this.#stableText && !fullText.startsWith(this.#stableText)) {
			this.#stableText = ""
			this.#stableOutput = ""
			this.#stableFenceState = EMPTY_FENCE
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
		this.#stableFenceState = EMPTY_FENCE
		this.#lastFullText = ""
		this.#lastFullOutput = ""
	}
}

function getFenceStateFromSeed(seed: FenceState, text: string): FenceState {
	let state = seed
	for (const line of text.split("\n")) state = parseFence(line, state) ?? state
	return state
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
