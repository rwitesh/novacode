import { EventStream } from "../eventStream.ts"
import type {
	AssistantResult,
	ContentPart,
	Effort,
	Msg,
	ProviderStream,
	StopReason,
	StreamEvent,
	StreamOpts,
	ToolDef,
	Usage,
} from "../types.ts"
import { streamPost } from "./http.ts"

interface GeminiPart {
	text?: string
	thought?: boolean
	inline_data?: { mime_type: string; data: string }
	function_call?: { name: string; args: Record<string, unknown> }
	function_response?: { name: string; response: Record<string, unknown> }
	thought_signature?: string
}

interface GeminiContent {
	role: "user" | "model"
	parts: GeminiPart[]
}

// thinkingLevel maps 1:1 to canonical low/medium/high. xhigh/max clamp to HIGH.
const THINKING_LEVEL: Record<Effort, string> = {
	low: "LOW",
	medium: "MEDIUM",
	high: "HIGH",
	xhigh: "HIGH",
	max: "HIGH",
}

function msgsToGemini(messages: Msg[]): GeminiContent[] {
	const contents: GeminiContent[] = []

	for (const msg of messages) {
		if (msg.role === "user") {
			const parts: GeminiPart[] =
				typeof msg.content === "string"
					? [{ text: msg.content }]
					: msg.content.map((c) => {
							if (c.type === "text") return { text: c.text }
							if (c.type === "image") return { inline_data: { mime_type: c.mime, data: c.data } }
							return { text: "" }
						})
			contents.push({ role: "user", parts })
		} else if (msg.role === "assistant") {
			const parts: GeminiPart[] = msg.content.map((c) => {
				if (c.type === "text") return { text: c.text, thought_signature: c.signature }
				if (c.type === "thinking")
					return { thought: true, text: c.text, thought_signature: c.signature }
				if (c.type === "tool_call") return { function_call: { name: c.name, args: c.args } }
				return { text: "" }
			})
			contents.push({ role: "model", parts })
		} else if (msg.role === "tool_result") {
			const part: GeminiPart = {
				function_response: {
					name: msg.tool,
					response: {
						content: msg.content
							.map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
							.join("\n"),
					},
				},
			}

			const last = contents[contents.length - 1]
			// Gemini requires alternating roles; group multiple responses
			if (last && last.role === "user" && last.parts.some((p) => p.function_response)) {
				last.parts.push(part)
			} else {
				contents.push({ role: "user", parts: [part] })
			}
		}
	}

	return contents
}

function toolsToGemini(tools: ToolDef[]): unknown[] {
	if (tools.length === 0) return []
	return [
		{
			function_declarations: tools.map((t) => ({
				name: t.name,
				description: t.description,
				parameters: t.parameters,
			})),
		},
	]
}

function mapFinishReason(reason: string): StopReason {
	if (reason === "STOP") return "stop"
	if (reason === "MAX_TOKENS") return "length"
	if (
		reason === "SAFETY" ||
		reason === "RECITATION" ||
		reason === "BLOCKLIST" ||
		reason === "PROHIBITED_CONTENT" ||
		reason === "OTHER"
	)
		return "error"
	return "stop"
}

export const geminiProvider: ProviderStream = {
	id: "gemini",
	efforts: { options: ["low", "medium", "high"], default: "high" },
	stream: (opts: StreamOpts): EventStream<StreamEvent, AssistantResult> => {
		const es = new EventStream<StreamEvent, AssistantResult>()
		const label = `${opts.provider[0]?.toUpperCase()}${opts.provider.slice(1)}`

		;(async () => {
			let usage: Usage = { in: 0, out: 0 }
			const content: ContentPart[] = []

			// Accumulate text/thinking across chunks; finalize at stream end
			let textAccum = ""
			let thinkingAccum = ""
			let thinkingSig = ""
			let textSig = ""

			try {
				const baseUrl = opts.baseUrl || "https://generativelanguage.googleapis.com"
				const url = `${baseUrl}/v1beta/models/${opts.model.id}:streamGenerateContent?alt=sse&key=${opts.apiKey}`

				const generationConfig: Record<string, unknown> = {
					maxOutputTokens: opts.model.maxOutput || undefined,
				}
				if (opts.model.supportsThinking) {
					generationConfig.thinkingConfig = {
						includeThoughts: true,
						thinkingLevel: THINKING_LEVEL[opts.effort] ?? "HIGH",
					}
				}

				const body: Record<string, unknown> = {
					contents: msgsToGemini(opts.messages),
					system_instruction: opts.system ? { parts: [{ text: opts.system }] } : undefined,
					tools: opts.tools.length > 0 ? toolsToGemini(opts.tools) : undefined,
					generationConfig,
				}

				const res = await streamPost(url, { "Api-Revision": "2026-05-20" }, body, opts.signal, {
					onRetry: (attempt, maxAttempts, delayMs, reason) => {
						es.push({ type: "retry", attempt, maxAttempts, delayMs, reason })
					},
				})

				if (!res.ok) {
					const errorText = await res.text()
					let msg = errorText
					try {
						const json = JSON.parse(errorText)
						msg = json.error?.message || json.message || errorText
					} catch {
						/* use raw text */
					}

					const errorMsg = `${label} Error (${res.status}): ${msg}`
					es.push({ type: "text_delta", text: errorMsg })
					es.finish({
						content: [{ type: "text", text: errorMsg }],
						usage: { in: 0, out: 0 },
						stop: "error",
					})
					return
				}

				let stop: StopReason = "stop"

				for await (const data of res.events()) {
					try {
						const parsed = JSON.parse(data)
						const candidate = parsed.candidates?.[0]

						if (parsed.usageMetadata) {
							usage = {
								in: parsed.usageMetadata.promptTokenCount || usage.in,
								out: parsed.usageMetadata.candidatesTokenCount || usage.out,
							}
							es.push({ type: "usage", usage })
						}

						if (!candidate) continue

						if (candidate.finishReason) {
							stop = mapFinishReason(candidate.finishReason)
						}

						const parts = candidate.content?.parts
						if (!parts) continue

						for (const part of parts) {
							const sig = part.thought_signature

							if (part.thought === true && part.text) {
								thinkingAccum += part.text
								if (sig) thinkingSig = sig
								es.push({ type: "thinking_delta", text: part.text })
								continue
							}

							if (part.text) {
								textAccum += part.text
								if (sig) textSig = sig
								es.push({ type: "text_delta", text: part.text })
								continue
							}

							if (part.function_call) {
								const fc = part.function_call
								const id = `call_${Math.random().toString(36).slice(2, 9)}`

								const toolCall: ContentPart = {
									type: "tool_call",
									id,
									name: fc.name,
									args: (fc.args as Record<string, unknown>) || {},
								}
								content.push(toolCall)
								es.push({ type: "tool_call", call: toolCall })
								stop = "tool_use"
							}
						}
					} catch {
						// Skip malformed JSON chunks
					}
				}

				// Finalize accumulated blocks into content
				if (thinkingAccum) {
					content.unshift({
						type: "thinking",
						text: thinkingAccum,
						signature: thinkingSig || undefined,
					})
				}
				if (textAccum) {
					// Insert text after thinking but before tool calls
					const insertIdx = content.findIndex((c) => c.type === "tool_call")
					const textPart: ContentPart = {
						type: "text",
						text: textAccum,
						signature: textSig || undefined,
					}
					if (insertIdx === -1) {
						content.push(textPart)
					} else {
						content.splice(insertIdx, 0, textPart)
					}
				}

				es.finish({ content, usage, stop })
			} catch (e) {
				if (opts.signal?.aborted) {
					es.finish({
						content,
						usage,
						stop: "aborted",
					})
					return
				}
				const errorMsg = `${label} Network/Request Error: ${e instanceof Error ? e.message : String(e)}`
				es.push({ type: "text_delta", text: errorMsg })
				es.finish({
					content: [{ type: "text", text: errorMsg }],
					usage: { in: 0, out: 0 },
					stop: "error",
				})
			}
		})()

		return es
	},
}
