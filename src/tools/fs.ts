import { mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { Tool, ToolResult } from "../types.ts"

export function readTool(cwd: string): Tool {
	return {
		def: {
			name: "read",
			description: "Read file contents. Supports text files and images.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Path to file (relative or absolute)" },
					offset: { type: "number", description: "Line to start from (1-indexed)" },
					limit: { type: "number", description: "Max lines to read" },
				},
				required: ["path"],
			},
		},
		async execute(args): Promise<ToolResult> {
			const filePath = resolve(cwd, args.path as string)
			try {
				const file = Bun.file(filePath)
				const exists = await file.exists()
				if (!exists) {
					return {
						content: [{ type: "text", text: `File not found: ${args.path}` }],
						isError: true,
					}
				}

				const text = await file.text()
				const lines = text.split("\n")
				const offset = Number(args.offset ?? 1) - 1
				const limit = args.limit ? Number(args.limit) : lines.length
				const sliced = lines.slice(offset, offset + limit)

				return {
					content: [{ type: "text", text: sliced.join("\n") }],
					isError: false,
				}
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error reading file: ${(e as Error).message}` }],
					isError: true,
				}
			}
		},
	}
}

export function writeTool(cwd: string): Tool {
	return {
		def: {
			name: "write",
			description: "Write content to a file. Creates the file and parent dirs if needed.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Path to file" },
					content: { type: "string", description: "Content to write" },
				},
				required: ["path", "content"],
			},
		},
		async execute(args): Promise<ToolResult> {
			const filePath = resolve(cwd, args.path as string)
			try {
				await mkdir(dirname(filePath), { recursive: true })
				await Bun.write(filePath, args.content as string)
				return {
					content: [{ type: "text", text: `Wrote ${args.path}` }],
					isError: false,
				}
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error writing file: ${(e as Error).message}` }],
					isError: true,
				}
			}
		},
	}
}

export function editTool(cwd: string): Tool {
	return {
		def: {
			name: "edit",
			description: "Edit a file using exact text replacement.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Path to file" },
					edits: {
						type: "string",
						description: "JSON array of {oldText, newText} replacements",
					},
				},
				required: ["path", "edits"],
			},
		},
		async execute(args): Promise<ToolResult> {
			const filePath = resolve(cwd, args.path as string)
			try {
				const file = Bun.file(filePath)
				const exists = await file.exists()
				if (!exists) {
					return {
						content: [{ type: "text", text: `File not found: ${args.path}` }],
						isError: true,
					}
				}

				let content = await file.text()
				const edits = JSON.parse(args.edits as string) as Array<{
					oldText: string
					newText: string
				}>

				for (const edit of edits) {
					if (!content.includes(edit.oldText)) {
						return {
							content: [{ type: "text", text: `oldText not found in ${args.path}` }],
							isError: true,
						}
					}
					content = content.replace(edit.oldText, edit.newText)
				}

				await Bun.write(filePath, content)
				return {
					content: [{ type: "text", text: `Edited ${args.path}` }],
					isError: false,
				}
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error editing file: ${(e as Error).message}` }],
					isError: true,
				}
			}
		},
	}
}

export function bashTool(cwd: string): Tool {
	return {
		def: {
			name: "bash",
			description: "Execute a shell command.",
			parameters: {
				type: "object",
				properties: {
					command: { type: "string", description: "Shell command to run" },
					timeout: { type: "number", description: "Timeout in seconds" },
				},
				required: ["command"],
			},
		},
		async execute(args, signal): Promise<ToolResult> {
			try {
				const proc = Bun.spawn(["sh", "-c", args.command as string], {
					cwd,
					stdout: "pipe",
					stderr: "pipe",
					signal,
				})

				const stdout = await new Response(proc.stdout).text()
				const stderr = await new Response(proc.stderr).text()
				const exitCode = await proc.exited

				const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : "")
				return {
					content: [{ type: "text", text: output || `(exit code ${exitCode})` }],
					isError: exitCode !== 0,
				}
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
					isError: true,
				}
			}
		},
	}
}
