/**
 * Search tools for finding files and content.
 * Uses 'rg' (ripgrep) if available, falling back to a pure JS implementation.
 */
import { readdir } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { glob } from "glob"
import type { Tool, ToolResult } from "../types.ts"

import { textPart } from "../util.ts"

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
					nocase: { type: "boolean", description: "Case-insensitive search (default false)" },
				},
				required: ["pattern"],
			},
		},
		async execute(args): Promise<ToolResult> {
			try {
				const rawPath = (args.path as string) || "."
				const dir = resolve(cwd, rawPath)
				if (dir !== cwd && !dir.startsWith(`${cwd}/`)) {
					throw new Error(`Path outside project: ${rawPath}`)
				}

				const pattern = args.pattern as string
				const nocase = !!args.nocase
				const files = await glob(pattern, { cwd: dir, nocase })
				const sliced = files.slice(0, 500)
				const relSearchPath = relative(cwd, dir)
				const prefix = relSearchPath ? `${relSearchPath}/` : ""
				const relFiles = sliced.map((f) => prefix + f)
				const out = relFiles.length > 0 ? relFiles.join("\n") : "No files found"
				return { content: [textPart(out)], isError: false }
			} catch (e) {
				return {
					content: [textPart(`Error: ${(e as Error).message}`)],
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
				const rawPath = (args.path as string) || "."
				const dir = resolve(cwd, rawPath)
				if (dir !== cwd && !dir.startsWith(`${cwd}/`)) {
					throw new Error(`Path outside project: ${rawPath}`)
				}

				const pattern = args.pattern as string
				const globFilter = args.glob as string | undefined
				const relSearchPath = relative(cwd, dir) || "."

				// rg is 10-100x faster than our JS fallback, but isn't always installed
				try {
					const cmd = ["rg", "--line-number", "--max-count", "200"]
					if (globFilter) cmd.push(`--glob=${globFilter}`)
					cmd.push("--", pattern, relSearchPath)

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
						return { content: [textPart(lines || "No matches")], isError: false }
					}
				} catch {
					// rg not available, fall through
				}

				// Pure JS fallback when rg is not available
				const files = await glob(globFilter || "**/*", { cwd: dir })
				const prefix = relSearchPath === "." ? "" : `${relSearchPath}/`
				const re = new RegExp(pattern, "i")
				const matches: string[] = []
				for (const file of files.slice(0, 500)) {
					if (signal?.aborted) break
					try {
						const content = await Bun.file(resolve(dir, file)).text()
						const lines = content.split("\n")
						for (let i = 0; i < lines.length && matches.length < 200; i++) {
							const line = lines[i]
							if (line && re.test(line)) matches.push(`${prefix}${file}:${i + 1}:${line}`)
						}
					} catch {
						// Skip binary/unreadable files silently
					}
				}
				return {
					content: [textPart(matches.join("\n") || "No matches")],
					isError: false,
				}
			} catch (e) {
				return {
					content: [textPart(`Error: ${(e as Error).message}`)],
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
				return { content: [textPart(lines.join("\n") || "(empty)")], isError: false }
			} catch (e) {
				return {
					content: [textPart(`Error: ${(e as Error).message}`)],
					isError: true,
				}
			}
		},
	}
}

/**
 * Tool for visualizing a truncated directory tree.
 */
export function treeTool(cwd: string): Tool {
	return {
		def: {
			name: "tree",
			description:
				"Print a visual directory tree structure, ignoring common ignored folders like node_modules and .git.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Directory to start tree from (default .)" },
					depth: { type: "number", description: "Maximum depth to traverse (default 3)" },
				},
				required: [],
			},
		},
		async execute(args): Promise<ToolResult> {
			try {
				const startDir = resolve(cwd, (args.path as string) || ".")
				const maxDepth = Number(args.depth ?? 3) || 3

				const ignoreList = new Set([
					".git",
					"node_modules",
					"dist",
					"build",
					".svelte-kit",
					".next",
					"out",
					".scannerwork",
					"coverage",
				])

				async function walk(dir: string, currentDepth: number, prefix: string): Promise<string> {
					if (currentDepth > maxDepth) return ""
					let result = ""

					const entries = await readdir(dir, { withFileTypes: true })
					const sorted = entries
						.filter((e) => !ignoreList.has(e.name))
						.sort((a, b) => {
							if (a.isDirectory() && !b.isDirectory()) return -1
							if (!a.isDirectory() && b.isDirectory()) return 1
							return a.name.localeCompare(b.name)
						})

					for (let i = 0; i < sorted.length; i++) {
						const entry = sorted[i]!
						const isLast = i === sorted.length - 1
						const connector = isLast ? "└── " : "├── "
						const childPrefix = prefix + (isLast ? "    " : "│   ")

						result += `${prefix}${connector}${entry.name}${entry.isDirectory() ? "/" : ""}\n`

						if (entry.isDirectory()) {
							result += await walk(resolve(dir, entry.name), currentDepth + 1, childPrefix)
						}
					}
					return result
				}

				const treeText = await walk(startDir, 1, "")
				return { content: [textPart(treeText || "(empty)")], isError: false }
			} catch (e) {
				return {
					content: [textPart(`Error: ${(e as Error).message}`)],
					isError: true,
				}
			}
		},
	}
}
