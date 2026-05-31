import axios from "axios"
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
			// Anthropic requires tool results to be grouped into a single user message
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
	return tools.map((t) => ({
		name: t.name,
		description: t.description,
		input_schema: t.parameters,
	}))
}

export const streamAnthropic: StreamFn = (
	opts: StreamOpts,
): EventStream<StreamEvent, AssistantResult> => {
	const es = new EventStream<StreamEvent, AssistantResult>()

	;(async () => {
		const usage: Usage = { in: 0, out: 0 }
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
				signature?: string
			}
		>()

		try {
			const baseUrl = opts.baseUrl || "https://api.anthropic.com"
			const url = `${baseUrl}/v1/messages`

			const body: Record<string, unknown> = {
				model: opts.model.id,
				messages: msgsToAnthropic(opts.messages),
				system: opts.system || undefined,
				max_tokens: opts.model.maxTokens || 4096,
				stream: true,
				cache_control: { type: "ephemeral" },
			}

			if (opts.tools.length > 0) {
				body.tools = toolsToAnthropic(opts.tools)
			}

			if (opts.model.supportsThinking) {
				body.thinking = {
					type: "adaptive",
				}
				body.output_config = {
					effort: "high",
				}
			}

			const response = await axios.post(url, body, {
				headers: {
					"Content-Type": "application/json",
					"x-api-key": opts.apiKey,
					"anthropic-version": "2023-06-01",
					"anthropic-beta": "prompt-caching-2024-07-31",
				},
				responseType: "stream",
				signal: opts.signal,
				validateStatus: () => true,
			})

			if (response.status < 200 || response.status >= 300) {
				let errorText = ""
				for await (const chunk of response.data) {
					errorText += chunk.toString("utf8")
				}
				let msg = errorText
				try {
					const json = JSON.parse(errorText)
					msg = json.error?.message || json.message || errorText
				} catch {
					/* use raw text */
				}

				const errorMsg = `Anthropic Error (${response.status}): ${msg}`
				es.push({ type: "text_delta", text: errorMsg })
				es.finish({
					content: [{ type: "text", text: errorMsg }],
					usage: { in: 0, out: 0 },
					stop: "error",
				})
				return
			}

			const decoder = new TextDecoder()
			let buffer = ""
			let stop: StopReason = "stop"

			for await (const chunk of response.data) {
				buffer += decoder.decode(chunk, { stream: true })
				const lines = buffer.split("\n")
				buffer = lines.pop() ?? ""

				for (const line of lines) {
					const trimmed = line.trim()
					if (!trimmed?.startsWith("data: ")) continue
					const data = trimmed.slice(6)

					try {
						const chunk = JSON.parse(data)

						if (chunk.type === "message_start") {
							if (chunk.message?.usage) {
								usage.in = chunk.message.usage.input_tokens ?? usage.in
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
								signature: block.signature ?? "",
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
								}
							}
						}

						if (chunk.type === "content_block_stop") {
							const idx = chunk.index
							const block = blocks.get(idx)
							if (block) {
								if (block.type === "text" && block.text) {
									content.push({ type: "text", text: block.text })
								} else if (block.type === "thinking" && block.thinking) {
									content.push({
										type: "thinking",
										text: block.thinking,
										signature: block.signature || undefined,
									})
								} else if (block.type === "tool_use") {
									let args = {}
									try {
										args = JSON.parse(block.partialJson || "{}")
									} catch {
										/* fallback */
									}
									const toolCall: ContentPart = {
										type: "tool_call",
										id: block.id,
										name: block.name,
										args,
										signature: block.signature || undefined,
									}
									content.push(toolCall)
									es.push({ type: "tool_call", call: toolCall })
									stop = "tool_use"
								}
							}
						}

						if (chunk.type === "message_delta") {
							if (chunk.usage) {
								usage.out = chunk.usage.output_tokens ?? usage.out
								if (chunk.usage.cache_read_input_tokens) {
									usage.cacheRead = chunk.usage.cache_read_input_tokens
								}
								if (chunk.usage.cache_creation_input_tokens) {
									usage.cacheWrite = chunk.usage.cache_creation_input_tokens
								}
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
								}
							}
						}
					} catch {
						// Skip malformed chunks or event noise
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
			const errorMsg = `Anthropic Network/Request Error: ${e instanceof Error ? e.message : String(e)}`
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
