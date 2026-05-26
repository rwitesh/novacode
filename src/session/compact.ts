import { getProvider } from "../config/providers.ts"
import { stream } from "../provider/stream.ts"
import type { CompactResult, Model, Msg } from "../types.ts"
import { estimateTokens } from "../util.ts"
import type { SessionStore } from "./store.ts"

function extractText(msg: Msg): string {
	if (typeof msg.content === "string") return msg.content
	return msg.content
		.filter((c) => c.type === "text")
		.map((c) => (c.type === "text" ? c.text : ""))
		.join("")
}

function estimateMsgTokens(msg: Msg): number {
	let chars = 0
	if (typeof msg.content === "string") {
		chars += msg.content.length
	} else if (Array.isArray(msg.content)) {
		for (const part of msg.content) {
			if (part.type === "text") chars += part.text.length
		}
	}
	return Math.ceil(chars / 4)
}

export async function compact(
	store: SessionStore,
	sessionId: string,
	messages: Msg[],
	model: Model,
	apiKey: string,
	baseUrl: string,
	cwd: string,
): Promise<CompactResult> {
	const tokensBefore = estimateTokens(messages)

	// Tail protection token budget: 10% of total context window, minimum 20,000 tokens
	const tailTokenBudget = Math.max(20000, Math.round(model.contextWindow * 0.1))

	let accumulatedTokens = 0
	let cutIndex = messages.length

	// Walk backward from the end to dynamically select the tail messages based purely on token budget
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]!
		const msgTokens = estimateMsgTokens(msg)

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
			if (m.role === "tool_result" && "tool" in m)
				return `Tool(${m.tool}): ${extractText(m).slice(0, 200)}`
			return ""
		})
		.join("\n\n")

	const summary = await generateSummary(convo, model, apiKey, baseUrl)
	if (!summary) {
		return { compacted: false, tokensBefore, tokensAfter: tokensBefore }
	}

	const summaryMsg: Msg = {
		role: "user",
		content: `[Prior context summary]\n${summary}`,
		ts: Date.now(),
	}

	await store.endSession(sessionId, "compacted")
	const newSession = await store.createContinuation(sessionId, cwd, model.id, model.provider)

	const newMsgs = [summaryMsg, ...tail]
	for (let i = 0; i < newMsgs.length; i++) {
		await store.append(newSession.id, newMsgs[i]!)
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
	baseUrl: string,
): Promise<string | null> {
	const provider = getProvider(model.provider)
	if (!provider) return null

	const es = stream({
		api: provider.api,
		model,
		apiKey,
		baseUrl,
		system:
			"Summarize this coding session concisely. Cover: what was asked, files touched, what was done, key decisions. Keep it under 300 words.",
		messages: [{ role: "user", content: convo, ts: Date.now() }],
		tools: [],
	})

	let summary = ""
	for await (const ev of es) {
		if (ev.type === "text_delta" && ev.text) {
			summary += ev.text
		}
	}

	return summary.trim() || null
}

export async function generateSessionTitle(
	messages: Msg[],
	model: Model,
	apiKey: string,
	baseUrl: string,
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

	const es = stream({
		api: provider.api,
		model,
		apiKey,
		baseUrl,
		system:
			"Generate a very short, descriptive, and concise title for this coding conversation. Do not use quotes or prefixes like 'Title:'. Max 6 words.",
		messages: [{ role: "user", content: convo, ts: Date.now() }],
		tools: [],
	})

	let title = ""
	for await (const ev of es) {
		if (ev.type === "text_delta" && ev.text) {
			title += ev.text
		}
	}

	return title.trim().replace(/^["']|["']$/g, "") || null
}
