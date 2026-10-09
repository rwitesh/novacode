import { PassThrough, Writable } from "node:stream"
import { setImmediate } from "node:timers/promises"
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider"
import { simulateReadableStream, tool } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import { Box, render, Text } from "ink"
import { act } from "react"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { Agent } from "../src/agent/agent.ts"
import { toToolResultOutput } from "../src/content.ts"
import type { SessionStore } from "../src/db/sessionStore.ts"
import { getDefaultModel } from "../src/models/lookup.ts"
import { PolicyEngine } from "../src/policy/engine.ts"
import { interactive } from "../src/tui/app.tsx"
import { Composer } from "../src/tui/components/composer.tsx"
import { Conversation } from "../src/tui/components/conversation.tsx"
import { EventRenderer } from "../src/tui/components/message.tsx"
import { StatusBar } from "../src/tui/components/statusBar.tsx"
import { Viewport } from "../src/tui/core/layout.tsx"
import { useAgentTurn } from "../src/tui/hooks/useAgentTurn.ts"
import { useInputHandler } from "../src/tui/hooks/useInputHandler.ts"
import { usePrompts } from "../src/tui/hooks/usePrompts.ts"
import { useSession } from "../src/tui/hooks/useSession.ts"
import { StreamingMarkdownRenderer } from "../src/tui/markdown/index.ts"
import { ApprovalPrompt, PasswordPrompt, SearchSelectPrompt } from "../src/tui/prompts.tsx"
import type { ToolResult } from "../src/types.ts"

const { createModel, dispatch } = vi.hoisted(() => ({ createModel: vi.fn(), dispatch: vi.fn() }))
vi.mock("../src/commands/index.ts", () => ({
	COMMANDS: [
		{ name: "update", desc: "update" },
		{ name: "compact", desc: "compact" },
	],
	dispatch,
}))
vi.mock("../src/providers.ts", () => ({ createModel, reasoningOpts: () => ({}) }))
vi.mock("../src/compact.ts", () => ({ generateSessionTitle: vi.fn() }))
vi.mock("../src/update.ts", () => ({
	getCurrentVersion: async () => "test",
	checkForUpdate: async () => null,
}))

beforeAll(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true))
afterAll(() => vi.unstubAllGlobals())
const cleanups: Array<() => void> = []
afterEach(async () => {
	await act(async () => {
		for (const cleanup of cleanups.splice(0)) cleanup()
	})
	vi.clearAllMocks()
})

async function mount(node: React.ReactNode, screenReader = false, tty = false) {
	const frames: Array<{ output: string; height: number }> = []
	const stdout = new Writable({
		write(chunk, _encoding, callback) {
			const output = String(chunk)
			frames.push({ output, height: output.split("\n").length })
			callback()
		},
	})
	Object.assign(stdout, { columns: 80, rows: 24, isTTY: tty })
	const stdin = new PassThrough()
	Object.assign(stdin, { isTTY: true, setRawMode: vi.fn(), ref: vi.fn(), unref: vi.fn() })
	let instance: ReturnType<typeof render> | undefined
	await act(async () => {
		instance = render(node, {
			stdout: stdout as NodeJS.WriteStream,
			stdin: stdin as unknown as NodeJS.ReadStream,
			stderr: stdout as NodeJS.WriteStream,
			debug: !tty,
			patchConsole: false,
			exitOnCtrlC: false,
			isScreenReaderEnabled: screenReader,
		})
	})
	if (!instance) throw new Error("Ink did not mount")
	cleanups.push(instance.unmount)
	return { ...instance, frames, stdout, stdin }
}

async function mountHook<T>(useHook: () => T) {
	let current: T | undefined
	function Harness() {
		current = useHook()
		return null
	}
	const view = await mount(<Harness />)
	return {
		...view,
		value: () => {
			if (current === undefined) throw new Error("Hook did not mount")
			return current
		},
	}
}

const usage = {
	inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 5, text: 5, reasoning: 0 },
}
function step(text: string, callId?: string): LanguageModelV4StreamPart[] {
	return [
		{ type: "text-start", id: "text" },
		{ type: "text-delta", id: "text", delta: text },
		{ type: "text-end", id: "text" },
		...(callId
			? [{ type: "tool-call" as const, toolCallId: callId, toolName: "read", input: "{}" }]
			: []),
		{
			type: "finish",
			finishReason: { unified: callId ? "tool-calls" : "stop", raw: undefined },
			usage,
		},
	]
}

function setupTurn(readResult: ToolResult = { content: ["one", "two"], isError: false }) {
	const model = getDefaultModel("openai")
	if (!model) throw new Error("Missing test model")
	const agent = new Agent({
		provider: model.provider,
		model,
		apiKey: "test",
		system: "test",
		messages: [{ role: "user", content: "Run tools" }],
		tools: {
			read: tool({
				inputSchema: z.object({}),
				execute: async () => readResult,
				toModelOutput: ({ output }) => toToolResultOutput(output),
			}),
		},
	})
	const store = {
		get: vi.fn().mockResolvedValue({ title: "Existing", contextTokens: 0 }),
		append: vi.fn().mockResolvedValue(undefined),
		setContextTokens: vi.fn().mockResolvedValue(undefined),
	} as unknown as SessionStore
	function useTurn() {
		const session = useSession(agent, store, "session", [])
		return useAgentTurn(
			agent,
			store,
			session.sessionId,
			session.setContextTokens,
			session.commitMsg,
			session.commitDelta,
		)
	}
	return { agent, store, useTurn }
}

function setupInput(commitMsg = vi.fn().mockResolvedValue(undefined)) {
	const { agent, store } = setupTurn()
	const run = vi.fn().mockResolvedValue(undefined)
	const exit = vi.fn()
	function useTestInput() {
		return useInputHandler({
			agent,
			store,
			session: {
				sessionId: "session",
				commitMsg,
				switchSession: vi.fn(),
				newSession: vi.fn(),
				addNotice: vi.fn(),
				clearNotices: vi.fn(),
			},
			turn: { busy: false, run, abort: vi.fn() },
			prompts: { select: vi.fn(), searchSelect: vi.fn(), confirm: vi.fn(), password: vi.fn() },
			mode: { type: "chat" },
			exit,
			handlePermissionSwitch: vi.fn(),
			skills: [],
		})
	}
	return { useTestInput, commitMsg, run, exit }
}

async function send(stdin: PassThrough, input: string) {
	await act(async () => {
		stdin.write(input)
		await setImmediate()
	})
}

describe("TUI input", () => {
	it("ignores control shortcuts in password input", async () => {
		const submit = vi.fn()
		const view = await mount(<PasswordPrompt message="API key" onSubmit={submit} />)
		await send(view.stdin, "abc")
		await send(view.stdin, "\x15")
		await send(view.stdin, "\x01")
		await send(view.stdin, "\r")
		expect(submit).toHaveBeenCalledWith("abc")
	})

	it.each(["/update ", "/compact now"])(
		"serializes commands and turn submission: %s",
		async (command) => {
			const deferred = Promise.withResolvers<string>()
			dispatch.mockReturnValue(deferred.promise)
			const { useTestInput, commitMsg, run } = setupInput()
			const view = await mountHook(useTestInput)
			await send(view.stdin, command)
			await send(view.stdin, "\r")
			expect(view.value().commandBusy).toBe(true)
			await send(view.stdin, "next prompt")
			await send(view.stdin, "\r")
			expect(commitMsg).not.toHaveBeenCalled()
			expect(run).not.toHaveBeenCalled()
			await act(async () => {
				deferred.resolve("done")
			})
			expect(view.value().commandBusy).toBe(false)
			await send(view.stdin, "\r")
			expect(run).toHaveBeenCalledTimes(1)
			expect(commitMsg).toHaveBeenCalledWith({ role: "user", content: "next prompt" })
		},
	)
})

describe("TUI approval visibility", () => {
	it.each([24, 16, 12])(
		"makes an overflowing command inspectable without hidden approval (%s rows)",
		async (rows) => {
			const { agent } = setupTurn()
			const resolve = vi.fn()
			const summary = `echo safe\n${"\n".repeat(100)}touch /tmp/approval-tail`
			const view = await mount(
				<Viewport>
					<ApprovalPrompt req={{ tool: "bash", risk: "execution", summary }} onResolve={resolve} />
					<StatusBar
						activity="approval"
						activityColor="white"
						model={agent.model}
						contextTokens={0}
						tip="test"
					/>
				</Viewport>,
			)
			await act(async () => {
				Object.assign(view.stdout, { rows })
				view.stdout.emit("resize")
				await setImmediate()
			})
			expect(view.frames.at(-1)?.output).toContain("more below")
			expect(view.frames.at(-1)?.output).toContain("Scroll to end")
			await send(view.stdin, "\x1b[C")
			await send(view.stdin, "\r")
			expect(resolve).not.toHaveBeenCalledWith(true)
			resolve.mockClear()
			await send(view.stdin, "\x1b[F")
			expect(view.frames.at(-1)?.output).toContain("touch /tmp/approval-tail")
			expect(view.frames.at(-1)?.output).toContain("←→ toggle")
			await send(view.stdin, "\x1b[C")
			await send(view.stdin, "\x1b[H")
			await send(view.stdin, "\r")
			expect(resolve).toHaveBeenCalledWith(false)
			resolve.mockClear()
			await send(view.stdin, "\x1b[F")
			await send(view.stdin, "\r")
			expect(resolve).toHaveBeenCalledWith(true)
		},
	)
})

describe("TUI submission cancellation", () => {
	it.each(["message", "command-ctrl-c", "command-ctrl-d"])(
		"cancels or exits during %s",
		async (scenario) => {
			const deferred = Promise.withResolvers<void>()
			dispatch.mockReturnValue(deferred.promise)
			const { useTestInput, run, exit } = setupInput(vi.fn(() => deferred.promise))
			const view = await mountHook(useTestInput)
			await send(view.stdin, scenario === "message" ? "prompt" : "/update ")
			await send(view.stdin, "\r")
			if (scenario === "command-ctrl-d") await send(view.stdin, "\x04")
			else {
				await send(view.stdin, "\x03")
				if (scenario === "command-ctrl-c") await send(view.stdin, "\x03")
			}
			if (scenario !== "message") expect(exit).toHaveBeenCalledTimes(1)
			await act(async () => {
				deferred.resolve()
			})
			expect(run).not.toHaveBeenCalled()
		},
	)
})

describe("TUI terminal safety", () => {
	it.each([false, true])(
		"does not emit untrusted OSC commands (screen reader: %s)",
		async (screenReader) => {
			const content = "before\x1b]52;c;UE9JU09O\x07\x1b]0;spoofed title\x07after"
			const stream = new StreamingMarkdownRenderer()
			const view = await mount(
				<Box flexDirection="column">
					<EventRenderer event={{ id: "user", type: "UserMessage", content }} />
					<EventRenderer event={{ id: "assistant", type: "AssistantMessage", content }} />
					<EventRenderer
						event={{ id: "active-text", type: "AssistantMessage", content: stream.update(content) }}
					/>
					<EventRenderer
						event={{
							id: "tool",
							type: "ToolFailed",
							toolCallId: "tool",
							toolName: "bash",
							args: content,
							error: content,
						}}
					/>
				</Box>,
				screenReader,
			)
			const output = view.frames.map((frame) => frame.output).join("")
			expect(output).not.toContain("\x1b]52")
			expect(output).not.toContain("\x1b]0;")
			expect(output).toContain("beforeafter")
		},
	)
})

describe("TUI live viewport", () => {
	it("emits full committed output once rather than leaking live redraws into history", async () => {
		const lines = Array.from({ length: 80 }, (_, i) => `line-${i}`).join("\n")
		const content = `unique-history-marker\n${lines}`
		const event = { id: "active-text", type: "AssistantMessage" as const, content }
		function Frame({ committed = false, suffix = "" }) {
			return (
				<Viewport>
					<Conversation
						committedEvents={committed ? [{ ...event, id: "assistant-0" }] : []}
						liveEvents={committed ? [] : [{ ...event, content: content + suffix }]}
					/>
					<Box flexShrink={0}>
						<Text>footer</Text>
					</Box>
				</Viewport>
			)
		}
		const view = await mount(<Frame />, false, true)
		await view.waitUntilRenderFlush()
		await act(async () => {
			view.rerender(<Frame suffix="\nlatest" />)
		})
		await view.waitUntilRenderFlush()
		await act(async () => {
			view.rerender(<Frame committed />)
		})
		await view.waitUntilRenderFlush()
		await act(async () => {
			view.rerender(<Frame committed />)
		})
		await view.waitUntilRenderFlush()
		const output = view.frames.map((frame) => frame.output).join("")
		expect(output.match(/unique-history-marker/g)).toHaveLength(1)
		expect(output).toContain("line-0")
		expect(output).toContain("line-79")
	})

	it("keeps long live responses out of scrollback while retaining the latest text", async () => {
		const content = Array.from({ length: 80 }, (_, i) => `line-${i}`).join("\n")
		const events = [{ id: "active-text", type: "AssistantMessage" as const, content }]
		const bounded = await mount(
			<Viewport>
				<Conversation committedEvents={[]} liveEvents={events} />
				<Box flexShrink={0}>
					<Text>footer</Text>
				</Box>
			</Viewport>,
		)
		const frame = bounded.frames.at(-1)
		expect(frame?.height).toBeLessThan(24)
		expect(frame?.output).toContain("line-79")
		expect(frame?.output).not.toContain("line-0\n")
		expect(frame?.output).toContain("footer")
	})
})

describe("TUI composer layout", () => {
	it("keeps the input tail, working indicator and footer visible for long input", async () => {
		const input = Array.from({ length: 60 }, (_, i) => `input-${i}`).join("\n")
		const view = await mount(
			<Viewport>
				<Conversation
					committedEvents={[]}
					liveEvents={[{ id: "active-working", type: "Thinking" }]}
				/>
				<Composer input={input} suggestions={[]} selCmdIdx={0} />
				<Box flexShrink={0} paddingBottom={1}>
					<Text>status</Text>
				</Box>
			</Viewport>,
		)
		const output = view.frames.at(-1)?.output
		expect(output).toContain("input-59")
		expect(output).toContain("Working")
		expect(output).toContain("status")
	})
})

describe("TUI menu layout", () => {
	it("fits a long model menu alongside its help and status", async () => {
		const options = Array.from({ length: 25 }, (_, i) => ({
			value: String(i),
			label: `model-${i} ${"long".repeat(30)}`,
		}))
		const view = await mount(
			<Viewport>
				<SearchSelectPrompt message="Choose model" options={options} onSelect={() => {}} />
				<Box flexShrink={0} paddingBottom={1}>
					<Text>status</Text>
				</Box>
			</Viewport>,
		)
		const output = view.frames.at(-1)?.output
		expect(output).toContain("model-0")
		expect(output).toContain("model-1 ")
		expect(output).toContain("Esc cancel")
		expect(output).toContain("status")
		await send(view.stdin, "\x1b[A")
		expect(view.frames.at(-1)?.output).toContain("model-24")
		await act(async () => {
			Object.assign(view.stdout, { columns: 40, rows: 18 })
			view.stdout.emit("resize")
			await setImmediate()
		})
		expect(view.frames.at(-1)?.height).toBeLessThan(18)
		expect(view.frames.at(-1)?.output).toContain("model-24")
		expect(view.frames.at(-1)?.output).toContain("Esc cancel")
	})
})

describe("TUI startup", () => {
	it("does not hide the cursor before fallible history loading", async () => {
		const { agent, store } = setupTurn()
		Object.assign(store, { history: vi.fn().mockRejectedValue(new Error("Cannot load history")) })
		const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
		Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
		const write = vi.spyOn(process.stdout, "write").mockReturnValue(true)
		try {
			await expect(
				interactive(
					agent,
					store,
					"session",
					[],
					false,
					new PolicyEngine("restricted", process.cwd()),
				),
			).rejects.toThrow("Cannot load history")
			expect(write).not.toHaveBeenCalledWith("\x1B[?25l")
		} finally {
			write.mockRestore()
			if (tty) Object.defineProperty(process.stdout, "isTTY", tty)
			else Reflect.deleteProperty(process.stdout, "isTTY")
		}
	})
})

describe("TUI session state", () => {
	it("does not publish a message when persistence fails", async () => {
		const { agent, store } = setupTurn()
		const view = await mountHook(() => useSession(agent, store, "session", []))
		vi.mocked(store.append).mockRejectedValueOnce(new Error("Disk full"))
		const initial = [...agent.messages]
		await act(async () => {
			await expect(view.value().commitMsg({ role: "user", content: "Not saved" })).rejects.toThrow(
				"Disk full",
			)
		})
		expect(agent.messages).toEqual(initial)
		expect(view.value().messages).toEqual([])
	})

	it("ignores stale initial context loading after a session switch", async () => {
		const { agent } = setupTurn()
		const initial = Promise.withResolvers<{ contextTokens: number }>()
		const store = {
			get: vi.fn((id: string) =>
				id === "session"
					? initial.promise
					: Promise.resolve({ provider: "unknown", model: "unknown", contextTokens: 25 }),
			),
			messages: vi.fn().mockResolvedValue([]),
			history: vi.fn().mockResolvedValue([]),
		} as unknown as SessionStore
		const view = await mountHook(() => useSession(agent, store, "session", []))
		await act(async () => {
			await view.value().switchSession("new-session")
		})
		expect(view.value().contextTokens).toBe(25)
		await act(async () => {
			initial.resolve({ contextTokens: 99 })
		})
		expect(view.value().contextTokens).toBe(25)
	})
})

describe("TUI stream commits", () => {
	it("shows tool failures before the step is committed", async () => {
		createModel.mockReturnValue(
			new MockLanguageModelV4({
				doStream: [
					{ stream: simulateReadableStream({ chunks: step("Reading", "call-1") }) },
					{ stream: simulateReadableStream({ chunks: step("Done") }) },
				],
			}),
		)
		const { useTurn, store } = setupTurn({ content: ["Cannot read file"], isError: true })
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		vi.mocked(store.append).mockImplementationOnce(async () => {
			entered.resolve()
			await release.promise
		})
		const { value: turn } = await mountHook(useTurn)
		let running: Promise<void> | undefined
		await act(async () => {
			running = turn().run(new AbortController())
			await entered.promise
		})
		expect(turn().activeTools).toMatchObject([
			{ id: "call-1", status: "failure", error: "Cannot read file" },
		])
		await act(async () => {
			release.resolve()
			await running
		})
	})

	it("surfaces error stream parts even when a step completed", async () => {
		createModel.mockReturnValue(
			new MockLanguageModelV4({
				doStream: {
					stream: simulateReadableStream({
						chunks: [...step("Partial"), { type: "error", error: new Error("Provider failed") }],
					}),
				},
			}),
		)
		const { useTurn, agent } = setupTurn()
		const { value: turn } = await mountHook(useTurn)
		await act(async () => {
			await turn().run(new AbortController())
		})
		expect(agent.messages).toContainEqual({ role: "assistant", content: "Error: Provider failed" })
	})

	it("persists every SDK step exactly once, including the final answer", async () => {
		createModel.mockReturnValue(
			new MockLanguageModelV4({
				doStream: [
					{ stream: simulateReadableStream({ chunks: step("First", "call-1") }) },
					{ stream: simulateReadableStream({ chunks: step("Second", "call-2") }) },
					{ stream: simulateReadableStream({ chunks: step("Final") }) },
				],
			}),
		)
		const { useTurn, agent, store } = setupTurn()
		const { value: turn } = await mountHook(useTurn)
		await act(async () => {
			await turn().run(new AbortController())
		})
		expect(agent.messages.map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"tool",
			"assistant",
			"tool",
			"assistant",
		])
		expect(agent.messages.filter((m) => m.role === "assistant").map((m) => m.content)).toEqual([
			expect.arrayContaining([{ type: "text", text: "First" }]),
			expect.arrayContaining([{ type: "text", text: "Second" }]),
			expect.arrayContaining([{ type: "text", text: "Final" }]),
		])
		expect(store.append).toHaveBeenCalledTimes(5)
		expect(turn().bufferedStream).toBe("")
	})
})

describe("TUI prompt coordination", () => {
	it("denies outstanding approvals on cancellation and ignores stale answers", async () => {
		const policy = new PolicyEngine("restricted", process.cwd())
		const view = await mountHook(() => usePrompts(policy))
		let approvals: Array<Promise<{ allow: boolean }>> = []
		await act(async () => {
			approvals = [
				policy.check({ name: "write", args: {} }),
				policy.check({ name: "bash", args: {} }),
			]
		})
		const staleAnswer = view.value().resolvePrompt
		await act(async () => {
			view.value().cancelPrompts()
			staleAnswer(true)
		})
		expect(await Promise.all(approvals)).toMatchObject([{ allow: false }, { allow: false }])
		expect(view.value().mode.type).toBe("chat")
	})

	it("denies outstanding approvals on unmount", async () => {
		const policy = new PolicyEngine("restricted", process.cwd())
		const view = await mountHook(() => usePrompts(policy))
		let approval: Promise<{ allow: boolean }> | undefined
		await act(async () => {
			approval = policy.check({ name: "write", args: {} })
		})
		await act(async () => {
			view.unmount()
		})
		expect(await approval).toMatchObject({ allow: false })
	})

	it("resolves parallel approvals in order instead of losing the first resolver", async () => {
		const policy = new PolicyEngine("restricted", process.cwd())
		const view = await mountHook(() => usePrompts(policy))
		let first: Promise<{ allow: boolean }> | undefined
		let second: Promise<{ allow: boolean }> | undefined
		await act(async () => {
			first = policy.check({ name: "bash", args: { command: "first" } })
			second = policy.check({ name: "bash", args: { command: "second" } })
		})
		expect(view.value().mode).toMatchObject({ type: "approval", req: { summary: "first" } })
		await act(async () => {
			view.value().resolvePrompt(false)
		})
		expect(await first).toMatchObject({ allow: false })
		expect(view.value().mode).toMatchObject({ type: "approval", req: { summary: "second" } })
		await act(async () => {
			view.value().resolvePrompt(true)
		})
		expect(await second).toEqual({ allow: true })
	})
})
