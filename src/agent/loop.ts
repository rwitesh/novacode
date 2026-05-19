/**
 * Core agent loop that orchestrates model interaction and tool execution.
 * Handles turns, tool routing, safety checks, and event streaming.
 */
import { stream } from "../provider/registry.ts"
import { EventStream } from "../provider/stream.ts"
import type {
	AgentEvent,
	AssistantMsg,
	LoopCtx,
	LoopOpts,
	Msg,
	ToolCallPart,
	ToolResultMsg,
} from "../types.ts"
import { consolidate, estimateTokens, textPart } from "../util.ts"

// Safety cap so a misbehaving model can't loop forever
const MAX_TURNS = 50

const isToolCall = (c: unknown): c is ToolCallPart =>
	typeof c === "object" && c !== null && (c as ToolCallPart).type === "tool_call"

/**
 * Start a long-running agent session that yields an EventStream of updates.
 */
export function run(
	input: string,
	ctx: LoopCtx,
	opts: LoopOpts,
	signal?: AbortSignal,
): EventStream<AgentEvent, Msg[]> {
	const es = new EventStream<AgentEvent, Msg[]>()
	const out: Msg[] = []
	const maxTurns = opts.maxTurns ?? MAX_TURNS

	const userMsg: Msg = { role: "user", content: input, ts: Date.now() }
	let activeCtx: LoopCtx = { ...ctx, messages: [...ctx.messages, userMsg] }
	out.push(userMsg)

	const tick = async () => {
		es.push({ type: "start" })

		try {
			let turns = 0
			while (turns < maxTurns) {
				if (signal?.aborted) break

				turns++
				es.push({ type: "turn" })

				// Warn before hitting the hard limit so the caller can compact/summarize
				const approxTokens = estimateTokens(activeCtx.messages)
				if (approxTokens > opts.model.contextWindow * 0.9) {
					es.push({
						type: "text_delta",
						text: `[warning] Approaching context limit (~${Math.round(approxTokens / 1000)}k / ${Math.round(opts.model.contextWindow / 1000)}k tokens)`,
					})
				}

				const reply = await getReply(activeCtx, opts, es, signal)
				out.push(reply)
				activeCtx = { ...activeCtx, messages: [...activeCtx.messages, reply] }
				es.push({ type: "assistant_msg", msg: reply })

				if (reply.stop === "error" || reply.stop === "aborted") {
					es.push({ type: "turn_end", msg: reply, results: [] })
					break
				}

				const calls = reply.content.filter(isToolCall)
				if (calls.length === 0) {
					es.push({ type: "turn_end", msg: reply, results: [] })
					break
				}

				// Execute tool calls
				const results: ToolResultMsg[] = []
				for (const call of calls) {
					if (signal?.aborted) break

					const tool = activeCtx.tools.find((t) => t.def.name === call.name)
					if (!tool) {
						const errResult: ToolResultMsg = {
							role: "tool_result",
							callId: call.id,
							tool: call.name,
							content: [textPart(`Unknown tool: ${call.name}`)],
							isError: true,
							ts: Date.now(),
						}
						results.push(errResult)
						activeCtx = { ...activeCtx, messages: [...activeCtx.messages, errResult] }
						out.push(errResult)
						continue
					}

					// beforeTool lets callers block dangerous operations (e.g. rm -rf)
					const blocked = await opts.beforeTool?.(call, call.args, activeCtx)
					if (blocked?.block) {
						const blockResult: ToolResultMsg = {
							role: "tool_result",
							callId: call.id,
							tool: call.name,
							content: [textPart(blocked.reason ?? "Blocked")],
							isError: true,
							ts: Date.now(),
						}
						results.push(blockResult)
						activeCtx = { ...activeCtx, messages: [...activeCtx.messages, blockResult] }
						out.push(blockResult)
						continue
					}

					// Execute
					const result = await tool.execute(call.args, signal)
					const toolMsg: ToolResultMsg = {
						role: "tool_result",
						callId: call.id,
						tool: call.name,
						args: call.args,
						content: result.content,
						isError: result.isError,
						ts: Date.now(),
					}

					results.push(toolMsg)
					activeCtx = { ...activeCtx, messages: [...activeCtx.messages, toolMsg] }
					out.push(toolMsg)
					es.push({ type: "tool_result", callId: call.id, result: toolMsg, args: call.args })

					await opts.afterTool?.(call, toolMsg, activeCtx)
				}

				es.push({ type: "turn_end", msg: reply, results })
			}

			if (turns >= maxTurns) {
				es.push({
					type: "text_delta",
					text: `[max turns reached (${maxTurns})]`,
				})
			}
		} catch (e) {
			if ((e as Error).name === "AbortError") {
				es.finish(out)
				return
			}
			throw e
		}

		es.finish(out)
	}

	tick()
	return es
}

async function getReply(
	ctx: LoopCtx,
	opts: LoopOpts,
	es: EventStream<AgentEvent, Msg[]>,
	signal?: AbortSignal,
): Promise<AssistantMsg> {
	const providerStream = stream({
		api: opts.api,
		model: opts.model,
		apiKey: opts.apiKey,
		baseUrl: opts.baseUrl,
		system: ctx.system,
		messages: ctx.messages,
		tools: ctx.tools.map((t) => t.def),
		signal,
	})

	const content: AssistantMsg["content"] = []
	let usage = { in: 0, out: 0 }

	// Accumulate content and proxy events to the outer stream
	for await (const ev of providerStream) {
		if (ev.type === "text_delta" && ev.text) {
			content.push(textPart(ev.text))
			es.push({ type: "text_delta", text: ev.text })
		} else if (ev.type === "thinking_delta" && ev.text) {
			content.push({ type: "thinking", text: ev.text })
			es.push({ type: "thinking_delta", text: ev.text })
		} else if (ev.type === "tool_call" && ev.call) {
			content.push(ev.call)
			es.push({ type: "tool_call", call: ev.call })
		} else if (ev.type === "usage" && ev.usage) {
			usage = ev.usage
			es.push({ type: "usage", usage })
		}
	}

	const res = providerStream.result
	if (res) {
		return {
			role: "assistant",
			content: consolidate(res.content.length > 0 ? res.content : content),
			model: opts.model.id,
			provider: opts.model.provider,
			usage: res.usage,
			stop: res.stop,
			ts: Date.now(),
		}
	}

	return {
		role: "assistant",
		content: consolidate(content),
		model: opts.model.id,
		provider: opts.model.provider,
		usage,
		stop: content.some((c) => c.type === "tool_call") ? "tool_use" : "stop",
		ts: Date.now(),
	}
}
