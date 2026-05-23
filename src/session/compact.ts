import { getProvider } from "../config/providers.ts"
import { stream } from "../provider/stream.ts"
import type { CompactResult, Model, Msg } from "../types.ts"
import { estimateTokens } from "../util.ts"
import type { SessionStore } from "./store.ts"

const COMPACT_THRESHOLD = 0.8
const KEEP_RECENT = 10

function extractText(msg: Msg): string {
	if (typeof msg.content === "string") return msg.content
	return msg.content
		.filter((c) => c.type === "text")
		.map((c) => (c.type === "text" ? c.text : ""))
		.join("")
}

function extractToolFiles(msg: Msg, toolName: string): string[] {
	if (msg.role !== "tool_result") return []
	if (!("tool" in msg) || msg.tool !== toolName) return []
	const text = extractText(msg)
	// Extract file paths from tool result content
	const lines = text.split("\n")
	return lines.filter((l) => l.trim().length > 0)
}

export function needsCompact(messages: Msg[], contextWindow: number): boolean {
	return estimateTokens(messages) > contextWindow * COMPACT_THRESHOLD
}

export async function compact(
	store: SessionStore,
	sessionId: string,
	messages: Msg[],
	model: Model,
	apiKey: string,
	baseUrl: string,
): Promise<CompactResult> {
	if (!needsCompact(messages, model.contextWindow)) {
		return { compacted: false, msgsRemoved: 0 }
	}

	const old = messages.slice(0, -KEEP_RECENT)
	if (old.length === 0) {
		return { compacted: false, msgsRemoved: 0 }
	}
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
		return { compacted: false, msgsRemoved: 0 }
	}

	const filesRead: string[] = []
	const filesWrote: string[] = []
	for (const m of old) {
		filesRead.push(...extractToolFiles(m, "read"))
		filesRead.push(...extractToolFiles(m, "glob"))
		filesWrote.push(...extractToolFiles(m, "write"))
		filesWrote.push(...extractToolFiles(m, "edit"))
	}

	const seqBefore = old.length
	await store.saveCompaction(
		sessionId,
		summary,
		[...new Set(filesRead)],
		[...new Set(filesWrote)],
		seqBefore,
	)
	await store.truncateBeforeSeq(sessionId, seqBefore + 1)

	// Insert the summary as a user message so the model retains context
	const summaryMsg: Msg = {
		role: "user",
		content: `[Prior context summary]\n${summary}`,
		ts: Date.now(),
	}
	await store.append(sessionId, summaryMsg)

	return { compacted: true, summary, msgsRemoved: old.length }
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
