/**
 * Tool for executing shell commands within the project root.
 * Supports timeouts and output truncation to protect the context window.
 */
import type { Tool, ToolResult } from "../types.ts"

import { textPart } from "../util.ts"

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

				// Start reading pipes immediately so they don't block the process
				const stdoutPromise = new Response(proc.stdout).text()
				const stderrPromise = new Response(proc.stderr).text()

				// Track whether we killed it vs normal exit, so the output reflects the cause
				let killed = false
				const timer = setTimeout(() => {
					killed = true
					proc.kill(9) // SIGKILL to be more aggressive against orphans
				}, timeoutMs)

				const onAbort = () => {
					killed = true
					proc.kill(9)
				}
				signal?.addEventListener("abort", onAbort, { once: true })

				const exitCode = await proc.exited
				clearTimeout(timer)
				signal?.removeEventListener("abort", onAbort)

				// After exitCode, pipes should close. We give them a tiny grace period
				// to avoid hanging on orphans.
				const stdout = await Promise.race([
					stdoutPromise,
					new Promise<string>((r) => setTimeout(() => r(""), 500)),
				])
				const stderr = await Promise.race([
					stderrPromise,
					new Promise<string>((r) => setTimeout(() => r(""), 500)),
				])

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

				return { content: [textPart(out)], isError: exitCode !== 0 || killed }
			} catch (e) {
				return {
					content: [textPart(`Error: ${(e as Error).message}`)],
					isError: true,
				}
			}
		},
	}
}
