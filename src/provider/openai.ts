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

function msgToOpenAI(msg: Msg): Record<string, unknown> {
	if (msg.role === "user") {
		return {
			role: "user",
			content:
				typeof msg.content === "string"
					? msg.content
					: msg.content.map((c) => {
							if (c.type === "text") return { type: "text", text: c.text }
							if (c.type === "image")
								return { type: "image_url", image_url: { url: `data:${c.mime};base64,${c.data}` } }
							return { type: "text", text: "" }
						}),
		}
	}
	if (msg.role === "assistant") {
		const parts: unknown[] = []
		for (const c of msg.content) {
			if (c.type === "text") parts.push({ type: "text", text: c.text })
			if (c.type === "thinking") parts.push({ type: "thinking", thinking: c.text })
			if (c.type === "tool_call")
				parts.push({
					type: "function",
					id: c.id,
					function: { name: c.name, arguments: JSON.stringify(c.args) },
				})
		}
		return { role: "assistant", content: parts }
	}
	// tool_result
	if (msg.role === "tool_result") {
		return {
			role: "tool",
			tool_call_id: msg.callId,
			content: msg.content.map((c) => (c.type === "text" ? c.text : JSON.stringify(c))).join("\n"),
		}
	}
	return { role: "user", content: "" }
}

function toolsToOpenAI(tools: ToolDef[]): unknown[] {
	return tools.map((t) => ({
		type: "function",
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		},
	}))
}

export const streamOpenAI: StreamFn = (
	opts: StreamOpts,
): EventStream<StreamEvent, AssistantResult> => {
	const es = new EventStream<StreamEvent, AssistantResult>()

	;(async () => {
		try {
			const body = {
				model: opts.model.id,
				messages: [{ role: "system", content: opts.system }, ...opts.messages.map(msgToOpenAI)],
				tools: opts.tools.length > 0 ? toolsToOpenAI(opts.tools) : undefined,
				stream: true,
			}

			const response = await fetch(`${opts.baseUrl}/chat/completions`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${opts.apiKey}`,
				},
				body: JSON.stringify(body),
				signal: opts.signal,
			})

			if (!response.ok) {
				const text = await response.text()
				const errorMsg = `API error ${response.status}: ${text}`
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
			const currentToolCalls = new Map<number, { id: string; name: string; args: string }>()
			let usage: Usage = { in: 0, out: 0 }
			let stop = "stop"
			const textParts: ContentPart[] = []

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
					if (data === "[DONE]") continue

					try {
						const chunk = JSON.parse(data)
						const delta = chunk.choices?.[0]?.delta
						if (!delta) continue

						if (delta.content) {
							es.push({ type: "text_delta", text: delta.content })
							textParts.push({ type: "text", text: delta.content })
						}

						if (delta.tool_calls) {
							for (const tc of delta.tool_calls) {
								const idx = tc.index ?? 0
								if (!currentToolCalls.has(idx)) {
									currentToolCalls.set(idx, {
										id: tc.id ?? "",
										name: tc.function?.name ?? "",
										args: "",
									})
								}
								const existing = currentToolCalls.get(idx)!
								if (tc.id) existing.id = tc.id
								if (tc.function?.name) existing.name = tc.function.name
								if (tc.function?.arguments) existing.args += tc.function.arguments
							}
						}

						if (chunk.usage) {
							usage = {
								in: chunk.usage.prompt_tokens ?? 0,
								out: chunk.usage.completion_tokens ?? 0,
							}
							es.push({ type: "usage", usage })
						}

						const finishReason = chunk.choices?.[0]?.finish_reason
						if (finishReason) stop = finishReason
					} catch {
						// Skip malformed JSON chunks
					}
				}
			}

			const content: AssistantResult["content"] = [...textParts]
			for (const [, tc] of currentToolCalls) {
				content.push({
					type: "tool_call",
					id: tc.id,
					name: tc.name,
					args: JSON.parse(tc.args || "{}"),
				})
				es.push({
					type: "tool_call",
					call: {
						type: "tool_call",
						id: tc.id,
						name: tc.name,
						args: JSON.parse(tc.args || "{}"),
					},
				})
				stop = "tool_use"
			}

			es.finish({ content, usage, stop: stop as StopReason })
		} catch (e) {
			if (opts.signal?.aborted) return
			const errorMsg = `Unexpected error: ${e instanceof Error ? e.message : String(e)}`
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

// Auto-register
register("openai", streamOpenAI)
