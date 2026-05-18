import { stream } from "../provider/registry.ts"
import { EventStream } from "../provider/stream.ts"
import type {
	AgentEvent,
	AssistantMsg,
	Model,
	Msg,
	StopReason,
	Tool,
	ToolCallPart,
	ToolResultMsg,
	Usage,
} from "../types.ts"

export interface LoopCtx {
	system: string
	messages: Msg[]
	tools: Tool[]
}

export interface LoopOpts {
	model: Model
	apiKey: string
	baseUrl: string
	beforeTool?: (
		call: ToolCallPart,
		args: unknown,
		ctx: LoopCtx,
	) => Promise<{ block?: boolean; reason?: string } | undefined>
	afterTool?: (call: ToolCallPart, result: ToolResultMsg, ctx: LoopCtx) => Promise<void>
}

const isToolCall = (c: unknown): c is ToolCallPart =>
	typeof c === "object" && c !== null && (c as ToolCallPart).type === "tool_call"

function text(s: string) {
	return { type: "text" as const, text: s }
}

export function run(
	input: string,
	ctx: LoopCtx,
	opts: LoopOpts,
	signal?: AbortSignal,
): EventStream<AgentEvent, Msg[]> {
	const es = new EventStream<AgentEvent, Msg[]>()
	const out: Msg[] = []

	const userMsg: Msg = { role: "user", content: input, ts: Date.now() }
	ctx.messages.push(userMsg)
	out.push(userMsg)

	const tick = async () => {
		es.push({ type: "start" })

		try {
			while (true) {
				if (signal?.aborted) break

				es.push({ type: "turn" })
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

					// beforeTool hook
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
		} catch (e) {
			// If aborted, finalize gracefully
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
	let usage: Usage = { in: 0, out: 0 }
	let stop: StopReason = "stop"

	// Collect the result first
	const result = await new Promise<unknown>((resolve) => {
		const check = async () => {
			while (!providerStream.isDone) {
				await new Promise((r) => setTimeout(r, 10))
			}
			resolve(providerStream.result)
		}
		check()
	})

	// Type assertion since we know the result structure
	const res = result as
		| {
				content: Array<{
					type: string
					text?: string
					id?: string
					name?: string
					args?: Record<string, unknown>
				}>
				usage: Usage
				stop: string
		  }
		| undefined

	if (res) {
		for (const c of res.content) {
			if (c.type === "text" && c.text !== undefined) {
				content.push(text(c.text))
			} else if (c.type === "tool_call" && c.id && c.name) {
				content.push({ type: "tool_call", id: c.id, name: c.name, args: c.args ?? {} })
			}
		}
		usage = res.usage
		stop = res.stop as StopReason
	}

	return {
		role: "assistant",
		content,
		model: opts.model.id,
		provider: opts.model.provider,
		usage,
		stop,
		ts: Date.now(),
	}
}
