/**
 * Git tools for executing safe repository operations programmatically.
 */

import { spawn } from "node:child_process"
import { tool } from "ai"
import { z } from "zod"
import { toToolResultOutput } from "../content.ts"
import type { ToolResult } from "../types.ts"

export const gitTool = (cwd: string) =>
	tool({
		description:
			"Execute safe, non-interactive git commands (status, diff, log, add, commit) in the repository.",
		inputSchema: z.object({
			action: z
				.enum(["status", "diff", "log", "add", "commit"])
				.describe("The git action to execute"),
			args: z.array(z.string()).optional().describe("Optional additional arguments or file paths"),
		}),
		execute: async (args, { abortSignal }): Promise<ToolResult> => {
			const action = args.action
			const extraArgs = args.args ?? []

			// Defense in depth: the enum constrains the model, but execute can be
			// called directly — re-verify before spawning git.
			const allowed = new Set(["status", "diff", "log", "add", "commit"])
			if (!allowed.has(action)) {
				return {
					content: [{ type: "text", text: `Error: Git action '${action}' is not supported.` }],
					isError: true,
				}
			}

			try {
				const cmd = ["git", action, ...extraArgs]
				const proc = spawn(cmd[0]!, cmd.slice(1), {
					cwd,
					stdio: ["ignore", "pipe", "pipe"],
					env: { ...process.env, PAGER: "cat" },
				})

				let stdout = ""
				let stderr = ""
				proc.stdout.on("data", (chunk: Buffer) => {
					stdout += chunk.toString()
				})
				proc.stderr.on("data", (chunk: Buffer) => {
					stderr += chunk.toString()
				})

				const onAbort = () => {
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
					abortSignal?.removeEventListener("abort", onAbort)
				}

				// Prevent context window blowout by truncating very large outputs
				const MAX = 50_000
				let out = ""
				if (stdout) out += stdout.slice(0, MAX)
				if (stderr) {
					if (out) out += "\n"
					out += stderr.slice(0, MAX - out.length)
				}
				if (out.length >= MAX) out += "\n…truncated"

				return {
					content: [{ type: "text", text: out || "(no output)" }],
					isError: exitCode !== 0,
				}
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error running git: ${(e as Error).message}` }],
					isError: true,
				}
			}
		},
		toModelOutput: ({ output }) => toToolResultOutput(output),
	})
