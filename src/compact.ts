import { generateText, type ModelMessage } from "ai"
import { summarizeToolOutput } from "./content.ts"
import type { SessionStore } from "./db/sessionStore.ts"
import { getProvider } from "./models/lookup.ts"
import { createModel, reasoningOpts } from "./providers.ts"
import { estimateTokens } from "./tokens.ts"
import type { CompactResult, Model } from "./types.ts"

function extractText(msg: ModelMessage): string {
	if (msg.role === "tool") {
		return msg.content
			.map((p) => (p.type === "tool-result" ? summarizeToolOutput(p.output).text : ""))
			.join("\n")
	}
	if (typeof msg.content === "string") return msg.content
	return msg.content
		.filter((p) => p.type === "text")
		.map((p) => (p.type === "text" ? p.text : ""))
		.join("")
}

export async function compact(
	store: SessionStore,
	sessionId: string,
	messages: ModelMessage[],
	model: Model,
	apiKey: string,
	cwd: string,
): Promise<CompactResult> {
	const stored = await store.get(sessionId)
	// Fall back to a char/4 estimate when no turn has run yet (fresh session).
	const tokensBefore =
		stored && stored.contextTokens > 0 ? stored.contextTokens : estimateTokens(messages)
	// Tail protection token budget: 10% of total context window, minimum 20,000 tokens
	const tailTokenBudget = Math.max(20000, Math.round(model.contextWindow * 0.1))

	let accumulatedTokens = 0
	let cutIndex = messages.length

	// Walk backward from the end to dynamically select the tail messages based purely on token budget
	for (let i = messages.length - 1; i >= 0; i--) {
		const msgTokens = estimateTokens([messages[i]!])

		if (accumulatedTokens + msgTokens <= tailTokenBudget) {
			accumulatedTokens += msgTokens
			cutIndex = i
		} else {
			break
		}
	}

	if (cutIndex <= 0) {
		return { compacted: false, tokensBefore, tokensAfter: tokensBefore }
	}

	const tail = messages.slice(cutIndex)
	const old = messages.slice(0, cutIndex)

	const convo = old
		.map((m) => {
			if (m.role === "user") return `User: ${extractText(m)}`
			if (m.role === "assistant") return `Assistant: ${extractText(m)}`
			if (m.role === "tool") return `Tool: ${extractText(m).slice(0, 200)}`
			return ""
		})
		.join("\n\n")

	const summary = await generateSummary(convo, model, apiKey)
	if (!summary) {
		return { compacted: false, tokensBefore, tokensAfter: tokensBefore }
	}

	const summaryMsg: ModelMessage = {
		role: "user",
		content: `[Prior context summary]\n${summary}`,
	}

	await store.endSession(sessionId, "compacted")
	const newSession = await store.createContinuation(sessionId, cwd, model.id, model.provider)

	const newMsgs: ModelMessage[] = [summaryMsg, ...tail]
	for (const msg of newMsgs) {
		await store.append(newSession.id, msg)
	}

	const tokensAfter = estimateTokens(newMsgs)
	if (tokensAfter >= tokensBefore) {
		return { compacted: false, tokensBefore, tokensAfter: tokensBefore }
	}

	return { compacted: true, summary, tokensBefore, tokensAfter, newSessionId: newSession.id }
}

async function generateSummary(
	convo: string,
	model: Model,
	apiKey: string,
): Promise<string | null> {
	const provider = getProvider(model.provider)
	if (!provider) return null

	const { text } = await generateText({
		model: createModel(provider.id, model.id, apiKey),
		system:
			"Summarize this coding session concisely. Cover: what was asked, files touched, what was done, key decisions. Keep it under 300 words.",
		prompt: convo,
		providerOptions: model.reasoning ? reasoningOpts(provider.id) : undefined,
	})

	return text.trim() || null
}

export async function generateSessionTitle(
	messages: ModelMessage[],
	model: Model,
	apiKey: string,
): Promise<string | null> {
	const provider = getProvider(model.provider)
	if (!provider) return null

	const convo = messages
		.slice(0, 4)
		.map((m) => {
			if (m.role === "user") return `User: ${extractText(m)}`
			if (m.role === "assistant") return `Assistant: ${extractText(m)}`
			return ""
		})
		.join("\n")

	const { text } = await generateText({
		model: createModel(provider.id, model.id, apiKey),
		system:
			"Generate a very short, descriptive, and concise title for this coding conversation. Do not use quotes or prefixes like 'Title:'. Max 6 words.",
		prompt: convo,
		providerOptions: model.reasoning ? reasoningOpts(provider.id) : undefined,
	})

	return (
		text
			.replace(/\s+/g, " ")
			.trim()
			.replace(/^["']|["']$/g, "")
			.slice(0, 60)
			.trim() || null
	)
}
