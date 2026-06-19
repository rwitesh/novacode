/**
 * Tool for executing shell commands within the project root.
 * Supports timeouts and output truncation to protect the context window.
 */

import { spawn } from "node:child_process"
import { tool } from "ai"
import { z } from "zod"
import { toToolResultOutput } from "../content.ts"
import type { ToolResult } from "../types.ts"

export const bashTool = (cwd: string) =>
	tool({
		description:
			"Execute a shell command. Returns stdout and stderr. Timeout after N seconds (default 120).",
		inputSchema: z.object({
			command: z.string().describe("Shell command to run"),
			timeout: z.number().optional().describe("Timeout in seconds (default 120)"),
		}),
		execute: async (args, { abortSignal }): Promise<ToolResult> => {
			const command = args.command
			const timeoutMs = (args.timeout ?? 120) * 1000

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
					proc.stdout.destroy()
					proc.stderr.destroy()
				}, timeoutMs)

				const onAbort = () => {
					killed = true
					proc.kill("SIGKILL")
					proc.stdout.destroy()
					proc.stderr.destroy()
				}
				abortSignal?.addEventListener("abort", onAbort, { once: true })

				let exitCode: number
				try {
					exitCode = await new Promise<number>((resolve, reject) => {
						proc.on("error", reject)
						proc.on("close", (code) => resolve(code ?? -1))
					})
				} finally {
					clearTimeout(timer)
					abortSignal?.removeEventListener("abort", onAbort)
				}

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

				return { content: [{ type: "text", text: out }], isError: exitCode !== 0 || killed }
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
					isError: true,
				}
			}
		},
		toModelOutput: ({ output }) => toToolResultOutput(output),
	})
