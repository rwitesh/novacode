import type { ModelMessage } from "ai"
import { estimateTokens } from "../tokens.ts"

/**
 * Trim message history to fit within a given maximum input token budget.
 *
 * It is turn-aware:
 * 1. If the first message is a compaction summary (starts with `[Prior context summary]`),
 *    it is ALWAYS preserved.
 * 2. Subsequent messages are grouped into turns starting with 'user' messages.
 * 3. We keep as many of the most recent turns as possible, cutting older ones turn-by-turn.
 */
export function trimMessages(messages: ModelMessage[], maxInputTokens: number): ModelMessage[] {
	if (messages.length === 0) return []

	const firstMsg = messages[0]
	// 1. Identify if the first message is a compaction summary.
	let hasSummary = false
	let summaryMsg: ModelMessage | null = null
	if (
		firstMsg &&
		firstMsg.role === "user" &&
		typeof firstMsg.content === "string" &&
		firstMsg.content.startsWith("[Prior context summary]")
	) {
		hasSummary = true
		summaryMsg = firstMsg
	}

	const startIdx = hasSummary ? 1 : 0
	if (startIdx >= messages.length) return messages

	// 2. Group the remaining messages into turns starting with 'user' role.
	const turns: ModelMessage[][] = []
	let currentTurn: ModelMessage[] = []

	for (let i = startIdx; i < messages.length; i++) {
		const msg = messages[i]
		if (!msg) continue
		if (msg.role === "user") {
			if (currentTurn.length > 0) {
				turns.push(currentTurn)
			}
			currentTurn = [msg]
		} else {
			currentTurn.push(msg)
		}
	}
	if (currentTurn.length > 0) {
		turns.push(currentTurn)
	}

	// 3. Keep as many recent turns as fit in the budget.
	let keepFromTurnIdx = turns.length - 1
	let accumulatedTokens = summaryMsg ? estimateTokens([summaryMsg]) : 0

	for (let i = turns.length - 1; i >= 0; i--) {
		const turn = turns[i]
		if (!turn) continue
		const turnTokens = estimateTokens(turn)
		if (accumulatedTokens + turnTokens <= maxInputTokens) {
			accumulatedTokens += turnTokens
			keepFromTurnIdx = i
		} else {
			break
		}
	}

	// 4. Construct the trimmed messages list.
	const trimmed: ModelMessage[] = []
	if (summaryMsg) {
		trimmed.push(summaryMsg)
	}
	for (let i = keepFromTurnIdx; i < turns.length; i++) {
		const turn = turns[i]
		if (turn) {
			trimmed.push(...turn)
		}
	}

	return trimmed
}
