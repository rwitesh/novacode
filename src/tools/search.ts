/**
 * Search tools for finding files and content.
 * Uses 'rg' (ripgrep) if available, falling back to a pure JS implementation.
 */
import { readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { glob } from "glob"
import type { Tool, ToolResult } from "../types.ts"

const text = (s: string) => ({ type: "text" as const, text: s })

/**
 * Tool for finding files by glob pattern.
 */
export function globTool(cwd: string): Tool {
	return {
		def: {
			name: "glob",
			description: "Find files by glob pattern (e.g. **/*.ts, src/**/*.test.ts).",
			parameters: {
				type: "object",
				properties: {
					pattern: { type: "string", description: "Glob pattern (e.g. **/*.ts)" },
					path: { type: "string", description: "Directory to search in (default .)" },
				},
				required: ["pattern"],
			},
		},
		async execute(args): Promise<ToolResult> {
			try {
				const dir = resolve(cwd, (args.path as string) || ".")
				const pattern = args.pattern as string
				const files = await glob(pattern, { cwd: dir })
				const sliced = files.slice(0, 500)
				const out = sliced.length > 0 ? sliced.join("\n") : "No files found"
				return { content: [text(out)], isError: false }
			} catch (e) {
				return {
					content: [text(`Error: ${(e as Error).message}`)],
					isError: true,
				}
			}
		},
	}
}

/**
 * Tool for searching file contents using regex.
 */
export function grepTool(cwd: string): Tool {
	return {
		def: {
			name: "grep",
			description:
				"Search file contents with a regex pattern. Returns matching lines with file paths and line numbers.",
			parameters: {
				type: "object",
				properties: {
					pattern: { type: "string", description: "Regex pattern to search for" },
					path: { type: "string", description: "Directory or file to search in (default .)" },
					glob: { type: "string", description: "File filter glob (e.g. *.ts)" },
				},
				required: ["pattern"],
			},
		},
		async execute(args, signal): Promise<ToolResult> {
			try {
				const dir = resolve(cwd, (args.path as string) || ".")
				const pattern = args.pattern as string
				const globFilter = args.glob as string | undefined

				// rg is 10-100x faster than our JS fallback, but isn't always installed
				try {
					const cmd = ["rg", "--line-number", "--max-count", "200"]
					if (globFilter) cmd.push(`--glob=${globFilter}`)
					cmd.push("--", pattern, dir)

					const proc = Bun.spawn(cmd, {
						cwd,
						stdout: "pipe",
						stderr: "pipe",
					})
					signal?.addEventListener("abort", () => proc.kill(), { once: true })
					const exitCode = await proc.exited
					signal?.removeEventListener("abort", () => proc.kill())

					if (exitCode === 0) {
						const out = await new Response(proc.stdout).text()
						const lines = out.split("\n").slice(0, 200).join("\n")
						return { content: [text(lines || "No matches")], isError: false }
					}
				} catch {
					// rg not available, fall through
				}

				// Pure JS fallback when rg is not available
				const files = await glob(globFilter || "**/*", { cwd: dir })
				const re = new RegExp(pattern, "i")
				const matches: string[] = []
				for (const rawFile of files.slice(0, 500)) {
					const file = rawFile as string
					if (signal?.aborted) break
					try {
						const content = await Bun.file(resolve(dir, file)).text()
						const lines = content.split("\n")
						for (let i = 0; i < lines.length && matches.length < 200; i++) {
							const line = lines[i]
							if (line && re.test(line)) matches.push(`${file}:${i + 1}:${line}`)
						}
					} catch {
						// Skip binary/unreadable files silently
					}
				}
				return {
					content: [text(matches.join("\n") || "No matches")],
					isError: false,
				}
			} catch (e) {
				return {
					content: [text(`Error: ${(e as Error).message}`)],
					isError: true,
				}
			}
		},
	}
}

/**
 * Tool for listing directory entries.
 */
export function lsTool(cwd: string): Tool {
	return {
		def: {
			name: "ls",
			description: "List directory contents.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Directory to list (default .)" },
				},
				required: [],
			},
		},
		async execute(args): Promise<ToolResult> {
			try {
				const dir = resolve(cwd, (args.path as string) || ".")
				const entries = await readdir(dir, { withFileTypes: true })
				const lines = entries.map((e) => {
					const suffix = e.isDirectory() ? "/" : e.isSymbolicLink() ? "@" : ""
					return `${e.name}${suffix}`
				})
				return { content: [text(lines.join("\n") || "(empty)")], isError: false }
			} catch (e) {
				return {
					content: [text(`Error: ${(e as Error).message}`)],
					isError: true,
				}
			}
		},
	}
}
