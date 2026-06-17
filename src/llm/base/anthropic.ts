import { EventStream } from "../../eventStream.ts"
import type {
	AssistantResult,
	ContentPart,
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

export interface AnthropicStreamConfig {
	// Remap a canonical effort before sending as output_config.effort. Defaults
	// to identity (Anthropic accepts all canonical levels directly).
	mapEffort?: (e: Effort) => Effort
}

function msgsToAnthropic(messages: Msg[]): Record<string, unknown>[] {
	const contents: Record<string, unknown>[] = []

	for (const msg of messages) {
		if (msg.role === "user") {
			const parts =
				typeof msg.content === "string"
					? [{ type: "text", text: msg.content }]
					: msg.content.map((c) => {
							if (c.type === "text") return { type: "text", text: c.text }
							if (c.type === "image") {
								return {
									type: "image",
									source: {
										type: "base64",
										media_type: c.mime,
										data: c.data,
									},
								}
							}
							return { type: "text", text: "" }
						})
			contents.push({ role: "user", content: parts })
		} else if (msg.role === "assistant") {
			const parts = msg.content.map((c) => {
				if (c.type === "text") return { type: "text", text: c.text }
				if (c.type === "thinking") {
					return {
						type: "thinking",
						thinking: c.text,
						signature: c.signature,
					}
				}
				if (c.type === "tool_call") {
					return {
						type: "tool_use",
						id: c.id,
						name: c.name,
						input: c.args,
					}
				}
				return { type: "text", text: "" }
			})
			contents.push({ role: "assistant", content: parts })
		} else if (msg.role === "tool_result") {
			const part = {
				type: "tool_result",
				tool_use_id: msg.callId,
				content: msg.content
					.map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
					.join("\n"),
				is_error: msg.isError ? true : undefined,
			}

			const last = contents[contents.length - 1]
			// Anthropic requires tool results to be grouped into one user message
			if (
				last &&
				last.role === "user" &&
				Array.isArray(last.content) &&
				// biome-ignore lint/suspicious/noExplicitAny: dynamic message content block
				last.content.some((p: any) => p.type === "tool_result")
			) {
				last.content.push(part)
			} else {
				contents.push({ role: "user", content: [part] })
			}
		}
	}

	return contents
}

function toolsToAnthropic(tools: ToolDef[]): unknown[] {
	return tools.map((t, i) => {
		const def: Record<string, unknown> = {
			name: t.name,
			description: t.description,
			input_schema: t.parameters,
		}
		if (i === tools.length - 1) {
			def.cache_control = { type: "ephemeral" }
		}
		return def
	})
}

// 4.5 needs an explicit budget; 4.6+ uses adaptive thinking.
function thinkingConfig(modelId: string): Record<string, unknown> {
	if (modelId === "claude-opus-4-5" || modelId === "claude-sonnet-4-5")
		return { type: "enabled", budget_tokens: 10000 }
	return { type: "adaptive" }
}

export function createStream(cfg: AnthropicStreamConfig = {}): StreamFn {
	const mapEffort = cfg.mapEffort ?? ((e: Effort) => e)
	return (opts: StreamOpts): EventStream<StreamEvent, AssistantResult> => {
		const es = new EventStream<StreamEvent, AssistantResult>()
		const label = `${opts.provider[0]?.toUpperCase()}${opts.provider.slice(1)}`

		;(async () => {
			let usage: Usage = { in: 0, out: 0 }
			const content: ContentPart[] = []
			const blocks = new Map<
				number,
				{
					type: string
					id: string
					name: string
					text: string
					thinking: string
					partialJson: string
					signature: string
				}
			>()

			try {
				const baseUrl = opts.baseUrl || "https://api.anthropic.com"
				const url = `${baseUrl}/v1/messages`

				const body: Record<string, unknown> = {
					model: opts.model.id,
					messages: msgsToAnthropic(opts.messages),
					system: opts.system
						? [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }]
						: undefined,
					max_tokens: opts.model.maxOutput || 16384,
					stream: true,
				}

				if (opts.tools.length > 0) {
					body.tools = toolsToAnthropic(opts.tools)
				}

				if (opts.model.supportsThinking) {
					body.thinking = thinkingConfig(opts.model.id)
					body.output_config = { effort: mapEffort(opts.effort) }
				}

				const res = await streamPost(
					url,
					{
						"x-api-key": opts.apiKey,
						"anthropic-version": "2023-06-01",
					},
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

						if (chunk.type === "message_start") {
							const u = chunk.message?.usage
							if (u) {
								const inputTokens =
									(u.input_tokens ?? 0) +
									(u.cache_creation_input_tokens ?? 0) +
									(u.cache_read_input_tokens ?? 0)
								usage = { in: inputTokens, out: u.output_tokens ?? 0 }
								es.push({ type: "usage", usage })
							}
						}

						if (chunk.type === "content_block_start") {
							const idx = chunk.index
							const block = chunk.content_block
							blocks.set(idx, {
								type: block.type,
								id: block.id ?? "",
								name: block.name ?? "",
								text: "",
								thinking: "",
								partialJson: "",
								signature: "",
							})
						}

						if (chunk.type === "content_block_delta") {
							const idx = chunk.index
							const delta = chunk.delta
							const block = blocks.get(idx)
							if (block) {
								if (delta.type === "text_delta" && delta.text) {
									block.text += delta.text
									es.push({ type: "text_delta", text: delta.text })
								} else if (delta.type === "thinking_delta" && delta.thinking) {
									block.thinking += delta.thinking
									es.push({ type: "thinking_delta", text: delta.thinking })
								} else if (delta.type === "input_json_delta" && delta.partial_json) {
									block.partialJson += delta.partial_json
								} else if (delta.type === "signature_delta" && delta.signature) {
									block.signature += delta.signature
								}
							}
						}

						if (chunk.type === "content_block_stop") {
							const idx = chunk.index
							const block = blocks.get(idx)
							if (block) {
								if (block.type === "text" && block.text) {
									content.push({ type: "text", text: block.text })
								} else if (block.type === "thinking" && (block.thinking || block.signature)) {
									content.push({
										type: "thinking",
										text: block.thinking,
										signature: block.signature || undefined,
									})
								} else if (block.type === "tool_use") {
									let args = {}
									try {
										args = JSON.parse(block.partialJson || "{}")
									} catch (e) {
										args = { _raw: block.partialJson, _parseError: (e as Error).message }
									}
									const toolCall: ContentPart = {
										type: "tool_call",
										id: block.id,
										name: block.name,
										args,
									}
									content.push(toolCall)
									es.push({ type: "tool_call", call: toolCall })
									stop = "tool_use"
								}
							}
						}

						if (chunk.type === "message_delta") {
							if (chunk.usage) {
								usage = { in: usage.in, out: chunk.usage.output_tokens ?? usage.out }
								es.push({ type: "usage", usage })
							}

							if (chunk.delta?.stop_reason) {
								const reason = chunk.delta.stop_reason
								if (reason === "end_turn" || reason === "stop_sequence") {
									stop = "stop"
								} else if (reason === "max_tokens") {
									stop = "length"
								} else if (reason === "tool_use") {
									stop = "tool_use"
								} else if (reason === "refusal") {
									stop = "refusal"
								}
							}
						}

						if (chunk.type === "error") {
							const errMsg = chunk.error?.message ?? "Unknown stream error"
							es.push({ type: "text_delta", text: `\n[Stream error: ${errMsg}]` })
						}
					} catch {
						// skip malformed JSON chunks
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
	}
}
