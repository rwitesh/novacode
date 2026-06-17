import { EventStream } from "../../eventStream.ts"
import type {
	AssistantResult,
	Effort,
	Msg,
	StopReason,
	StreamEvent,
	StreamFn,
	StreamOpts,
	ToolDef,
	Usage,
} from "../../types.ts"
import { streamPost } from "../http.ts"

export interface OpenAIStreamConfig {
	mapEffort: (e: Effort) => string | undefined
	thinkingToggle?: boolean
	maxTokensField: "max_tokens" | "max_completion_tokens"
}

function mapFinishReason(reason: string): StopReason {
	if (reason === "stop") return "stop"
	if (reason === "length") return "length"
	if (reason === "tool_calls") return "tool_use"
	if (reason === "content_filter") return "error"
	return "stop"
}

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
		const textParts: string[] = []
		const toolCalls: unknown[] = []

		for (const c of msg.content) {
			if (c.type === "text") textParts.push(c.text)
			if (c.type === "tool_call")
				toolCalls.push({
					type: "function",
					id: c.id,
					function: { name: c.name, arguments: JSON.stringify(c.args) },
				})
		}

		const result: Record<string, unknown> = {
			role: "assistant",
			content: textParts.length > 0 ? textParts.join("") : null,
		}
		if (toolCalls.length > 0) result.tool_calls = toolCalls
		return result
	}
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

export function createStream(cfg: OpenAIStreamConfig): StreamFn {
	return (opts: StreamOpts): EventStream<StreamEvent, AssistantResult> => {
		const es = new EventStream<StreamEvent, AssistantResult>()
		const label = `${opts.provider[0]?.toUpperCase()}${opts.provider.slice(1)}`

		;(async () => {
			let textContent = ""
			const currentToolCalls = new Map<number, { id: string; name: string; args: string }>()
			let usage: Usage = { in: 0, out: 0 }

			try {
				const body: Record<string, unknown> = {
					model: opts.model.id,
					messages: [{ role: "system", content: opts.system }, ...opts.messages.map(msgToOpenAI)],
					tools: opts.tools.length > 0 ? toolsToOpenAI(opts.tools) : undefined,
					[cfg.maxTokensField]: opts.model.maxOutput || undefined,
					stream: true,
					stream_options: { include_usage: true },
				}

				if (opts.model.supportsThinking) {
					const effortValue = cfg.mapEffort(opts.effort)
					if (effortValue) body.reasoning_effort = effortValue
					if (cfg.thinkingToggle) body.thinking = { type: "enabled" }
				}

				const res = await streamPost(
					`${opts.baseUrl}/chat/completions`,
					{ Authorization: `Bearer ${opts.apiKey}` },
					body,
					opts.signal,
					{
						onRetry: (attempt, maxAttempts, delayMs, reason) => {
							es.push({ type: "retry", attempt, maxAttempts, delayMs, reason })
						},
					},
				)

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
						const chunk = JSON.parse(data)
						const delta = chunk.choices?.[0]?.delta
						if (!delta) continue

						if (delta.content) {
							es.push({ type: "text_delta", text: delta.content })
							textContent += delta.content
						}

						const reasoning = delta.reasoning_content || delta.reasoning || delta.thinking
						if (reasoning) {
							es.push({ type: "thinking_delta", text: reasoning })
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
						if (finishReason) stop = mapFinishReason(finishReason)

						if (delta.refusal) {
							stop = "refusal"
						}
					} catch {
						// skip malformed JSON chunks
					}
				}

				const content: AssistantResult["content"] = []
				if (textContent) {
					content.push({ type: "text", text: textContent })
				}
				for (const [, tc] of currentToolCalls) {
					let args: Record<string, unknown> = {}
					try {
						args = JSON.parse(tc.args || "{}")
					} catch {
						args = { _raw: tc.args }
					}
					content.push({ type: "tool_call", id: tc.id, name: tc.name, args })
					es.push({
						type: "tool_call",
						call: { type: "tool_call", id: tc.id, name: tc.name, args },
					})
					stop = "tool_use"
				}

				es.finish({ content, usage, stop })
			} catch (e) {
				if (opts.signal?.aborted) {
					const content: AssistantResult["content"] = []
					if (textContent) {
						content.push({ type: "text", text: textContent })
					}
					for (const [, tc] of currentToolCalls) {
						try {
							content.push({
								type: "tool_call",
								id: tc.id,
								name: tc.name,
								args: JSON.parse(tc.args || "{}"),
							})
						} catch {
							// skip malformed
						}
					}
					es.finish({
						content,
						usage,
						stop: "aborted",
					})
					return
				}
				const errorMsg = `${label} Error: ${e instanceof Error ? e.message : String(e)}`
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
}
