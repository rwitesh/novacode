/**
 * Filesystem tools for reading, writing, and editing files.
 * Includes safety checks to prevent path traversal.
 */
import { mkdir } from "node:fs/promises"
import { dirname, extname, resolve } from "node:path"
import type { Tool, ToolResult } from "../types.ts"
import { getRelativeIfInside, textPart } from "../util.ts"

// Extensions we return as base64 images instead of text
const IMAGES = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"])

function safePath(cwd: string, p: string): string {
	const abs = resolve(cwd, p)
	if (abs !== cwd && !abs.startsWith(`${cwd}/`)) {
		throw new Error(`Path outside project: ${p}`)
	}
	return abs
}

export function readTool(cwd: string): Tool {
	return {
		def: {
			name: "read",
			description:
				"Read file contents. Supports text and images (jpg, png, gif, webp). Text output is truncated to 2000 lines.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Path to file (relative or absolute)" },
					offset: { type: "number", description: "Start line (1-based, default 1)" },
					limit: { type: "number", description: "Max lines to read (default 2000)" },
				},
				required: ["path"],
			},
		},
		async execute(args): Promise<ToolResult> {
			try {
				const filePath = safePath(cwd, args.path as string)
				const relPath = getRelativeIfInside(cwd, filePath)
				const file = Bun.file(filePath)
				if (!(await file.exists())) {
					return { content: [textPart(`File not found: ${relPath}`)], isError: true }
				}

				// Return images as base64 so the LLM can process them visually
				const ext = extname(filePath).toLowerCase()
				if (IMAGES.has(ext)) {
					const buf = await file.arrayBuffer()
					const b64 = Buffer.from(buf).toString("base64")
					const mime = ext === ".jpg" ? "image/jpeg" : `image/${ext.slice(1)}`
					return { content: [{ type: "image", data: b64, mime }], isError: false }
				}

				const content = await file.text()
				const lines = content.split("\n")
				const offset = Math.max(0, (Number(args.offset ?? 1) || 1) - 1)
				const limit = Number(args.limit ?? 2000) || 2000
				const slice = lines.slice(offset, offset + limit)
				const truncated = offset + limit < lines.length

				const out = slice.join("\n")
				const suffix = truncated ? `\n…${lines.length - offset - limit} more lines` : ""

				return { content: [textPart(out + suffix)], isError: false }
			} catch (e) {
				return {
					content: [textPart(`Error reading file: ${(e as Error).message}`)],
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
			description: "Write content to a file. Creates the file and parent directories if needed.",
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
			try {
				const filePath = safePath(cwd, args.path as string)
				const content = args.content as string
				await mkdir(dirname(filePath), { recursive: true })
				await Bun.write(filePath, content)
				const relPath = getRelativeIfInside(cwd, filePath)
				return {
					content: [textPart(`Wrote ${content.length} bytes → ${relPath}`)],
					isError: false,
				}
			} catch (e) {
				return {
					content: [textPart(`Error writing file: ${(e as Error).message}`)],
					isError: true,
				}
			}
		},
	}
}

// Requires oldText to be unique to avoid ambiguous replacements.
export function editTool(cwd: string): Tool {
	return {
		def: {
			name: "edit",
			description:
				"Edit a file using exact text replacement. Each edit's oldText must be unique in the file.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "Path to file" },
					edits: {
						type: "array",
						description:
							"Array of {oldText, newText} replacements. oldText must be unique. Non-overlapping.",
						items: {
							type: "object",
							properties: {
								oldText: { type: "string", description: "Exact text to find (must be unique)" },
								newText: { type: "string", description: "Replacement text" },
							},
							required: ["oldText", "newText"],
						},
					},
				},
				required: ["path", "edits"],
			},
		},
		async execute(args): Promise<ToolResult> {
			try {
				const filePath = safePath(cwd, args.path as string)
				const file = Bun.file(filePath)
				if (!(await file.exists())) {
					return { content: [textPart(`File not found: ${args.path}`)], isError: true }
				}

				let content = await file.text()
				const edits = args.edits as Array<{ oldText: string; newText: string }>

				// Validate all edits before applying any — avoids partial writes on bad input
				for (const edit of edits) {
					const count = content.split(edit.oldText).length - 1
					if (count === 0) {
						return {
							content: [textPart(`oldText not found: "${edit.oldText.slice(0, 80)}…"`)],
							isError: true,
						}
					}
					// Ambiguous match would replace the wrong occurrence
					if (count > 1) {
						return {
							content: [
								textPart(
									`oldText found ${count} times — add surrounding context to make it unique: "${edit.oldText.slice(0, 60)}…"`,
								),
							],
							isError: true,
						}
					}
				}

				// Apply edits sequentially
				for (const edit of edits) {
					content = content.replace(edit.oldText, edit.newText)
				}

				await Bun.write(filePath, content)
				const relPath = getRelativeIfInside(cwd, filePath)
				return {
					content: [
						textPart(
							`Edited ${relPath} (${edits.length} replacement${edits.length > 1 ? "s" : ""})`,
						),
					],
					isError: false,
				}
			} catch (e) {
				return {
					content: [textPart(`Error editing file: ${(e as Error).message}`)],
					isError: true,
				}
			}
		},
	}
}
