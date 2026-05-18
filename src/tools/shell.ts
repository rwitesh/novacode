/**
 * Tool for executing shell commands within the project root.
 * Supports timeouts and output truncation to protect the context window.
 */
import type { Tool, ToolResult } from "../types.ts"

const text = (s: string) => ({ type: "text" as const, text: s })

/**
 * Tool for running bash commands.
 */
export function bashTool(cwd: string): Tool {
	return {
		def: {
			name: "bash",
			description:
				"Execute a shell command. Returns stdout and stderr. Timeout after N seconds (default 120).",
			parameters: {
				type: "object",
				properties: {
					command: { type: "string", description: "Shell command to run" },
					timeout: { type: "number", description: "Timeout in seconds (default 120)" },
				},
				required: ["command"],
			},
		},
		async execute(args, signal): Promise<ToolResult> {
			const command = args.command as string
			const timeoutMs = (Number(args.timeout) || 120) * 1000

			try {
				const proc = Bun.spawn(["sh", "-c", command], {
					cwd,
					stdout: "pipe",
					stderr: "pipe",
				})

				// Track whether we killed it vs normal exit, so the output reflects the cause
				let killed = false
				const timer = setTimeout(() => {
					killed = true
					proc.kill()
				}, timeoutMs)

				const onAbort = () => {
					killed = true
					proc.kill()
				}
				signal?.addEventListener("abort", onAbort, { once: true })

				const exitCode = await proc.exited
				clearTimeout(timer)
				signal?.removeEventListener("abort", onAbort)

				const stdout = await new Response(proc.stdout).text()
				const stderr = await new Response(proc.stderr).text()

				// Prevent context-window blowout from noisy commands
				const MAX = 50_000
				let out = ""
				if (stdout) out += stdout.slice(0, MAX)
				if (stderr) {
					if (out) out += "\n"
					out += stderr.slice(0, MAX - out.length)
				}
				if (out.length >= MAX) out += `\n…truncated`

				if (killed) out += `\n[timeout after ${timeoutMs / 1000}s]`
				out += `\n[exit ${exitCode}]`

				return { content: [text(out)], isError: exitCode !== 0 }
			} catch (e) {
				return {
					content: [text(`Error: ${(e as Error).message}`)],
					isError: true,
				}
			}
		},
	}
}
