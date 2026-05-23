import type {
	AssistantResult,
	ContentPart,
	Msg,
	StopReason,
	StreamEvent,
	StreamFn,
	StreamOpts,
	ToolDef,
	Usage,
} from "../types.ts"
import { EventStream } from "./stream.ts"

interface GeminiPart {
	text?: string
	thought?: boolean | string
	inline_data?: { mime_type: string; data: string }
	function_call?: { name: string; args: Record<string, unknown> }
	function_response?: { name: string; response: Record<string, unknown> }
	thought_signature?: string
}

interface GeminiContent {
	role: "user" | "model"
	parts: GeminiPart[]
}

/**
 * Maps our internal Msg format to the Gemini 'Content' format.
 * Groups consecutive tool_result messages into a single Gemini message.
 */
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
				if (c.type === "tool_call")
					return { function_call: { name: c.name, args: c.args }, thought_signature: c.signature }
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
			// Gemini requires alternating roles; multiple function_responses group into one 'user' message.
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

export const streamGemini: StreamFn = (
	opts: StreamOpts,
): EventStream<StreamEvent, AssistantResult> => {
	const es = new EventStream<StreamEvent, AssistantResult>()

	;(async () => {
		let usage: Usage = { in: 0, out: 0 }
		const content: ContentPart[] = []

		try {
			const baseUrl = opts.baseUrl || "https://generativelanguage.googleapis.com"
			const url = `${baseUrl}/v1beta/models/${opts.model.id}:streamGenerateContent?alt=sse&key=${opts.apiKey}`

			const body = {
				contents: msgsToGemini(opts.messages),
				system_instruction: opts.system ? { parts: [{ text: opts.system }] } : undefined,
				tools: opts.tools.length > 0 ? toolsToGemini(opts.tools) : undefined,
				generationConfig: {
					thinkingConfig: opts.model.supportsThinking ? { thinkingLevel: "low" } : undefined,
				},
			}

			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Api-Revision": "2026-05-20",
				},
				body: JSON.stringify(body),
				signal: opts.signal,
			})

			if (!response.ok) {
				const text = await response.text()
				let msg = text
				try {
					const json = JSON.parse(text)
					msg = json.error?.message || json.message || text
				} catch {
					/* use raw text */
				}

				const errorMsg = `Gemini Error (${response.status}): ${msg}`
				es.push({ type: "text_delta", text: errorMsg })
				es.finish({
					content: [{ type: "text", text: errorMsg }],
					usage: { in: 0, out: 0 },
					stop: "error",
				})
				return
			}

			const reader = response.body?.getReader()
			if (!reader) {
				es.finish({ content: [], usage: { in: 0, out: 0 }, stop: "error" })
				return
			}

			const decoder = new TextDecoder()
			let buffer = ""
			let stop: StopReason = "stop"

			while (true) {
				const { done, value } = await reader.read()
				if (done) break

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split("\n")
				buffer = lines.pop() ?? ""

				for (const line of lines) {
					const trimmed = line.trim()
					if (!trimmed?.startsWith("data: ")) continue
					const data = trimmed.slice(6)

					try {
						const chunk = JSON.parse(data)
						const candidate = chunk.candidates?.[0]

						// Handle usage metadata
						if (chunk.usageMetadata) {
							usage = {
								in: chunk.usageMetadata.promptTokenCount || usage.in,
								out: chunk.usageMetadata.candidatesTokenCount || usage.out,
							}
							es.push({ type: "usage", usage })
						}

						if (!candidate) continue

						// Map finish reason
						if (candidate.finishReason) {
							const reason = candidate.finishReason
							if (reason === "STOP") stop = "stop"
							else if (reason === "MAX_TOKENS") stop = "length"
							else if (reason === "SAFETY" || reason === "RECITATION" || reason === "OTHER")
								stop = "error"
						}

						const parts = candidate.content?.parts
						if (parts) {
							for (const part of parts) {
								const sig = part.thought_signature || part.thoughtSignature

								// Handle text and thinking deltas
								if (part.text) {
									if (part.thought === true || typeof part.thought === "string") {
										const thoughtText = typeof part.thought === "string" ? part.thought : part.text
										es.push({ type: "thinking_delta", text: thoughtText })
										const last = content[content.length - 1]
										if (last?.type === "thinking") {
											last.text += thoughtText
										} else {
											content.push({ type: "thinking", text: thoughtText, signature: sig })
										}
									} else {
										es.push({ type: "text_delta", text: part.text })
										const last = content[content.length - 1]
										if (last?.type === "text") {
											last.text += part.text
										} else {
											content.push({ type: "text", text: part.text, signature: sig })
										}
									}
								}

								// Handle function calls (can be snake_case or camelCase in some API versions)
								const fc = part.functionCall || part.function_call
								if (fc) {
									const name = fc.name
									const args = (fc.args as Record<string, unknown>) || {}
									const id = `call_${Math.random().toString(36).slice(2, 9)}`

									const toolCall: ContentPart = {
										type: "tool_call",
										id,
										name,
										args,
										signature: sig,
									}
									content.push(toolCall)
									es.push({ type: "tool_call", call: toolCall })
									stop = "tool_use"
								}
							}
						}
					} catch (_e) {
						if (data.trim() !== "" && data.trim() !== "[DONE]") {
							// skip noise
						}
					}
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
			const errorMsg = `Gemini Network/Request Error: ${e instanceof Error ? e.message : String(e)}`
			es.push({ type: "text_delta", text: errorMsg })
			es.finish({
				content: [{ type: "text", text: errorMsg }],
				usage: { in: 0, out: 0 },
				stop: "error",
			})
		}
	})()

	return es
}
