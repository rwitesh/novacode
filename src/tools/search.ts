/**
 * Search tools for finding files and content.
 * Uses 'rg' (ripgrep) if available, falling back to a pure JS implementation.
 */

import { spawn } from "node:child_process"
import { readdir, readFile } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { tool } from "ai"
import { glob } from "glob"
import { z } from "zod"
import { toToolResultOutput } from "../content.ts"
import type { ToolResult } from "../types.ts"

export const globTool = (cwd: string) =>
	tool({
		description: "Find files by glob pattern (e.g. **/*.ts, src/**/*.test.ts).",
		inputSchema: z.object({
			pattern: z.string().describe("Glob pattern (e.g. **/*.ts)"),
			path: z.string().optional().describe("Directory to search in (default .)"),
			nocase: z.boolean().optional().describe("Case-insensitive search (default false)"),
		}),
		execute: async (args): Promise<ToolResult> => {
			try {
				const dir = resolve(cwd, args.path ?? ".")
				const files = await glob(args.pattern, { cwd: dir, nocase: args.nocase ?? false })
				const sliced = files.slice(0, 500)
				const relSearchPath = relative(cwd, dir)
				const prefix = relSearchPath ? `${relSearchPath}/` : ""
				const relFiles = sliced.map((f) => prefix + f)
				const out = relFiles.length > 0 ? relFiles.join("\n") : "No files found"
				return { content: [{ type: "text", text: out }], isError: false }
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
					isError: true,
				}
			}
		},
		toModelOutput: ({ output }) => toToolResultOutput(output),
	})

export const grepTool = (cwd: string) =>
	tool({
		description:
			"Search file contents with a regex pattern. Returns matching lines with file paths and line numbers.",
		inputSchema: z.object({
			pattern: z.string().describe("Regex pattern to search for"),
			path: z.string().optional().describe("Directory or file to search in (default .)"),
			glob: z.string().optional().describe("File filter glob (e.g. *.ts)"),
		}),
		execute: async (args, { abortSignal }): Promise<ToolResult> => {
			try {
				const dir = resolve(cwd, args.path ?? ".")
				const globFilter = args.glob
				const relSearchPath = relative(cwd, dir) || "."

				// rg is 10-100x faster than our JS fallback, but isn't always installed
				try {
					const cmd = ["rg", "--line-number", "--max-count", "200"]
					if (globFilter) cmd.push(`--glob=${globFilter}`)
					cmd.push("--", args.pattern, relSearchPath)

					const proc = spawn(cmd[0]!, cmd.slice(1), {
						cwd,
						stdio: ["ignore", "pipe", "pipe"],
					})

					const onAbort = () => {
						proc.kill()
						proc.stdout.destroy()
						proc.stderr.destroy()
					}
					abortSignal?.addEventListener("abort", onAbort, { once: true })

					let stdout = ""
					proc.stdout.on("data", (chunk: Buffer) => {
						stdout += chunk.toString()
					})

					let exitCode: number
					try {
						exitCode = await new Promise<number>((resolveP, reject) => {
							proc.on("error", reject)
							proc.on("close", (code) => resolveP(code ?? -1))
						})
					} finally {
						abortSignal?.removeEventListener("abort", onAbort)
					}

					if (exitCode === 0) {
						const lines = stdout.split("\n").slice(0, 200).join("\n")
						return { content: [{ type: "text", text: lines || "No matches" }], isError: false }
					}
				} catch {
					// rg not available, fall through
				}

				// Pure JS fallback when rg is not available
				const files = await glob(globFilter || "**/*", {
					cwd: dir,
					ignore: ["**/node_modules/**", "**/.git/**"],
				})
				const prefix = relSearchPath === "." ? "" : `${relSearchPath}/`
				const re = new RegExp(args.pattern, "i")
				const matches: string[] = []
				for (const file of files.slice(0, 500)) {
					if (abortSignal?.aborted) break
					try {
						const content = await readFile(resolve(dir, file), "utf-8")
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
					content: [{ type: "text", text: matches.join("\n") || "No matches" }],
					isError: false,
				}
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
					isError: true,
				}
			}
		},
		toModelOutput: ({ output }) => toToolResultOutput(output),
	})

export const lsTool = (cwd: string) =>
	tool({
		description: "List directory contents.",
		inputSchema: z.object({
			path: z.string().optional().describe("Directory to list (default .)"),
		}),
		execute: async (args): Promise<ToolResult> => {
			try {
				const dir = resolve(cwd, args.path ?? ".")
				const entries = await readdir(dir, { withFileTypes: true })
				const lines = entries.map((e) => {
					const suffix = e.isDirectory() ? "/" : e.isSymbolicLink() ? "@" : ""
					return `${e.name}${suffix}`
				})
				return { content: [{ type: "text", text: lines.join("\n") || "(empty)" }], isError: false }
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
					isError: true,
				}
			}
		},
		toModelOutput: ({ output }) => toToolResultOutput(output),
	})

export const treeTool = (cwd: string) =>
	tool({
		description:
			"Print a visual directory tree structure, ignoring common ignored folders like node_modules and .git.",
		inputSchema: z.object({
			path: z.string().optional().describe("Directory to start tree from (default .)"),
			depth: z.number().optional().describe("Maximum depth to traverse (default 3)"),
		}),
		execute: async (args): Promise<ToolResult> => {
			try {
				const startDir = resolve(cwd, args.path ?? ".")
				const maxDepth = args.depth ?? 3

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
				return { content: [{ type: "text", text: treeText || "(empty)" }], isError: false }
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
					isError: true,
				}
			}
		},
		toModelOutput: ({ output }) => toToolResultOutput(output),
	})
