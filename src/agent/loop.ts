/**
 * Core agent loop that orchestrates model interaction and tool execution.
 * Handles turns, tool routing, safety checks, and event streaming.
 */
import { stream } from "../provider/registry.ts"
import { EventStream } from "../provider/stream.ts"
import type {
	AgentEvent,
	AssistantMsg,
	Model,
	Msg,
	Tool,
	ToolCallPart,
	ToolResultMsg,
} from "../types.ts"

// Safety cap so a misbehaving model can't loop forever
const MAX_TURNS = 50

export interface LoopCtx {
	system: string
	messages: Msg[]
	tools: Tool[]
}

/**
 * Execution options for the loop, including safety hooks.
 */
export interface LoopOpts {
	model: Model
	apiKey: string
	baseUrl: string
	maxTurns?: number
	// Intercept tool calls before they execute
	beforeTool?: (
		call: ToolCallPart,
		args: unknown,
		ctx: LoopCtx,
	) => Promise<{ block?: boolean; reason?: string } | undefined>
	// Run logic after a tool completes
	afterTool?: (call: ToolCallPart, result: ToolResultMsg, ctx: LoopCtx) => Promise<void>
}

const isToolCall = (c: unknown): c is ToolCallPart =>
	typeof c === "object" && c !== null && (c as ToolCallPart).type === "tool_call"

function text(s: string) {
	return { type: "text" as const, text: s }
}

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
	ctx.messages.push(userMsg)
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
				const approxTokens = estimateTokens(ctx.messages)
				if (approxTokens > opts.model.contextWindow * 0.9) {
					es.push({
						type: "text_delta",
						text: `[warning] Approaching context limit (~${Math.round(approxTokens / 1000)}k / ${Math.round(opts.model.contextWindow / 1000)}k tokens)`,
					})
				}

				const reply = await getReply(ctx, opts, signal)
				out.push(reply)

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

					const tool = ctx.tools.find((t) => t.def.name === call.name)
					if (!tool) {
						const errResult: ToolResultMsg = {
							role: "tool_result",
							callId: call.id,
							tool: call.name,
							content: [text(`Unknown tool: ${call.name}`)],
							isError: true,
							ts: Date.now(),
						}
						results.push(errResult)
						ctx.messages.push(errResult)
						out.push(errResult)
						continue
					}

					// beforeTool lets callers block dangerous operations (e.g. rm -rf)
					const blocked = await opts.beforeTool?.(call, call.args, ctx)
					if (blocked?.block) {
						const blockResult: ToolResultMsg = {
							role: "tool_result",
							callId: call.id,
							tool: call.name,
							content: [text(blocked.reason ?? "Blocked")],
							isError: true,
							ts: Date.now(),
						}
						results.push(blockResult)
						ctx.messages.push(blockResult)
						out.push(blockResult)
						continue
					}

					// Execute
					const result = await tool.execute(call.args, signal)
					const toolMsg: ToolResultMsg = {
						role: "tool_result",
						callId: call.id,
						tool: call.name,
						content: result.content,
						isError: result.isError,
						ts: Date.now(),
					}

					results.push(toolMsg)
					ctx.messages.push(toolMsg)
					out.push(toolMsg)

					await opts.afterTool?.(call, toolMsg, ctx)
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
				es.push({ type: "done", stop: "aborted" })
				es.finish(out)
				return
			}
			throw e
		}

		es.push({ type: "done", stop: "stop" })
		es.finish(out)
	}

	tick()
	return es
}

async function getReply(ctx: LoopCtx, opts: LoopOpts, signal?: AbortSignal): Promise<AssistantMsg> {
	const providerStream = stream({
		model: opts.model,
		apiKey: opts.apiKey,
		baseUrl: opts.baseUrl,
		system: ctx.system,
		messages: ctx.messages,
		tools: ctx.tools.map((t) => t.def),
		signal,
	})

	const content: AssistantMsg["content"] = []

	// Accumulate content by consuming provider events — the stream may not
	// have a usable .result depending on how the registry bridge works
	for await (const ev of providerStream) {
		if (ev.type === "text_delta") {
			content.push(text(ev.text))
		} else if (ev.type === "tool_call") {
			content.push(ev.call)
		}
	}

	return {
		role: "assistant",
		content,
		model: opts.model.id,
		provider: opts.model.provider,
		usage: { in: 0, out: 0 },
		stop: content.some((c) => c.type === "tool_call") ? "tool_use" : "stop",
		ts: Date.now(),
	}
}

// Rough token estimate: ~4 chars per token for English/code.
// Real tokenizers vary, but this is close enough for capacity warnings.
function estimateTokens(messages: Msg[]): number {
	let chars = 0
	for (const msg of messages) {
		if (typeof msg.content === "string") {
			chars += msg.content.length
		} else if (Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part.type === "text") chars += part.text.length
			}
		}
	}
	return Math.ceil(chars / 4)
}
