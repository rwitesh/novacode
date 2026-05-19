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
import { register } from "./registry.ts"
import { EventStream } from "./stream.ts"

function msgToGemini(msg: Msg): Record<string, unknown> {
	if (msg.role === "user") {
		return {
			role: "user",
			parts:
				typeof msg.content === "string"
					? [{ text: msg.content }]
					: msg.content.map((c) => {
							if (c.type === "text") return { text: c.text }
							if (c.type === "image") return { inlineData: { mimeType: c.mime, data: c.data } }
							return { text: "" }
						}),
		}
	}
	if (msg.role === "assistant") {
		return {
			role: "model",
			parts: msg.content.map((c) => {
				if (c.type === "text") return { text: c.text }
				if (c.type === "thinking") return { text: `<thought>\n${c.text}\n</thought>\n` }
				if (c.type === "tool_call") {
					return {
						functionCall: {
							name: c.name,
							args: c.args,
						},
					}
				}
				return { text: "" }
			}),
		}
	}
	if (msg.role === "tool_result") {
		return {
			role: "user", // Gemini uses 'user' role for functionResponse parts
			parts: [
				{
					functionResponse: {
						name: msg.tool,
						response: {
							content: msg.content
								.map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
								.join("\n"),
						},
					},
				},
			],
		}
	}
	return { role: "user", parts: [] }
}

function toolsToGemini(tools: ToolDef[]): unknown[] {
	return [
		{
			functionDeclarations: tools.map((t) => ({
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
		try {
			const baseUrl = opts.baseUrl || "https://generativelanguage.googleapis.com"
			const url = `${baseUrl}/v1beta/models/${opts.model.id}:streamGenerateContent?alt=sse&key=${opts.apiKey}`

			const body = {
				contents: opts.messages.map(msgToGemini),
				systemInstruction: opts.system ? { parts: [{ text: opts.system }] } : undefined,
				tools: opts.tools.length > 0 ? toolsToGemini(opts.tools) : undefined,
			}

			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: opts.signal,
			})

			if (!response.ok) {
				const text = await response.text()
				const errorMsg = `Gemini API error ${response.status}: ${text}`
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
			let usage: Usage = { in: 0, out: 0 }
			let stop: StopReason = "stop"
			const content: ContentPart[] = []

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
						if (!candidate) continue

						if (candidate.content?.parts) {
							for (const part of candidate.content.parts) {
								if (part.text) {
									es.push({ type: "text_delta", text: part.text })
									content.push({ type: "text", text: part.text })
								}
								if (part.functionCall) {
									const call: ContentPart = {
										type: "tool_call",
										id: `call_${Math.random().toString(36).slice(2, 9)}`, // Gemini calls don't always have IDs in the same way OpenAI does
										name: part.functionCall.name,
										args: part.functionCall.args || {},
									}
									es.push({ type: "tool_call", call })
									content.push(call)
									stop = "tool_use"
								}
							}
						}

						if (chunk.usageMetadata) {
							usage = {
								in: chunk.usageMetadata.promptTokenCount ?? 0,
								out: chunk.usageMetadata.candidatesTokenCount ?? 0,
							}
							es.push({ type: "usage", usage })
						}

						if (candidate.finishReason) {
							const reason = candidate.finishReason.toLowerCase()
							if (reason === "stop") stop = "stop"
							else if (reason === "max_tokens") stop = "length"
							else if (reason === "safety" || reason === "other") stop = "error"
						}
					} catch {
						// Skip malformed JSON
					}
				}
			}

			es.finish({ content, usage, stop })
		} catch (e) {
			if (opts.signal?.aborted) return
			const errorMsg = `Unexpected Gemini error: ${e instanceof Error ? e.message : String(e)}`
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

register("gemini", streamGemini)
