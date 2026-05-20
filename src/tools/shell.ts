/**
 * Tool for executing shell commands within the project root.
 * Supports timeouts and output truncation to protect the context window.
 */
import { spawn } from "node:child_process"
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
				const proc = spawn("sh", ["-c", command], { cwd, stdio: ["ignore", "pipe", "pipe"] })

				let stdout = ""
				let stderr = ""
				proc.stdout.on("data", (chunk: Buffer) => {
					stdout += chunk.toString()
				})
				proc.stderr.on("data", (chunk: Buffer) => {
					stderr += chunk.toString()
				})

				let killed = false
				const timer = setTimeout(() => {
					killed = true
					proc.kill("SIGKILL")
				}, timeoutMs)

				const onAbort = () => {
					killed = true
					proc.kill("SIGKILL")
				}
				signal?.addEventListener("abort", onAbort, { once: true })

				const exitCode = await new Promise<number>((resolve) => {
					proc.on("close", resolve)
				})
				clearTimeout(timer)
				signal?.removeEventListener("abort", onAbort)

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
