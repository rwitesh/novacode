/**
 * Git tools for executing safe repository operations programmatically.
 */
import type { Tool, ToolResult } from "../types.ts"
import { textPart } from "../util.ts"

export function gitTool(cwd: string): Tool {
	return {
		def: {
			name: "git",
			description:
				"Execute safe, non-interactive git commands (status, diff, log, add, commit) in the repository.",
			parameters: {
				type: "object",
				properties: {
					action: {
						type: "string",
						enum: ["status", "diff", "log", "add", "commit"],
						description: "The git action to execute",
					},
					args: {
						type: "array",
						description: "Optional additional arguments or file paths for the git action",
						items: { type: "string" },
					},
				},
				required: ["action"],
			},
		},
		async execute(args, signal): Promise<ToolResult> {
			const action = args.action as string
			const extraArgs = (args.args as string[]) || []

			const allowed = new Set(["status", "diff", "log", "add", "commit"])
			if (!allowed.has(action)) {
				return {
					content: [textPart(`Error: Git action '${action}' is not supported.`)],
					isError: true,
				}
			}

			try {
				const cmd = ["git", action, ...extraArgs]
				const proc = Bun.spawn(cmd, {
					cwd,
					stdout: "pipe",
					stderr: "pipe",
					env: { ...process.env, PAGER: "cat" },
				})

				const onAbort = () => proc.kill()
				signal?.addEventListener("abort", onAbort, { once: true })

				const exitCode = await proc.exited
				signal?.removeEventListener("abort", onAbort)

				const stdout = await new Response(proc.stdout).text()
				const stderr = await new Response(proc.stderr).text()

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
					content: [textPart(out || "(no output)")],
					isError: exitCode !== 0,
				}
			} catch (e) {
				return {
					content: [textPart(`Error running git: ${(e as Error).message}`)],
					isError: true,
				}
			}
		},
	}
}
