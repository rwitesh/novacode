/**
 * Filesystem tools for reading, writing, and editing files.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, extname, resolve } from "node:path"
import { tool } from "ai"
import { z } from "zod"
import { toToolResultOutput } from "../content.ts"
import { getRelativeIfInside } from "../paths.ts"
import type { ToolResult } from "../types.ts"

// Extensions we return as base64 images instead of text
const IMAGES = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"])

export const readTool = (cwd: string) =>
	tool({
		description:
			"Read file contents. Supports text and images (jpg, png, gif, webp). Text output is truncated to 2000 lines.",
		inputSchema: z.object({
			path: z.string().describe("Path to file (relative or absolute)"),
			offset: z.number().optional().describe("Start line (1-based, default 1)"),
			limit: z.number().optional().describe("Max lines to read (default 2000)"),
		}),
		execute: async (args): Promise<ToolResult> => {
			try {
				const filePath = resolve(cwd, args.path)
				// Return images as base64 so the LLM can process them visually
				const ext = extname(filePath).toLowerCase()
				if (IMAGES.has(ext)) {
					const buf = await readFile(filePath)
					const b64 = buf.toString("base64")
					const mime = ext === ".jpg" ? "image/jpeg" : `image/${ext.slice(1)}`
					return { content: [{ type: "image", data: b64, mime }], isError: false }
				}

				const content = await readFile(filePath, "utf-8")
				const lines = content.split("\n")
				const offset = Math.max(0, (args.offset ?? 1) - 1)
				const limit = args.limit ?? 2000
				const slice = lines.slice(offset, offset + limit)
				const truncated = offset + limit < lines.length

				const out = slice.join("\n")
				const suffix = truncated ? `\n…${lines.length - offset - limit} more lines` : ""

				return { content: [{ type: "text", text: out + suffix }], isError: false }
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error reading file: ${(e as Error).message}` }],
					isError: true,
				}
			}
		},
		toModelOutput: ({ output }) => toToolResultOutput(output),
	})

export const writeTool = (cwd: string) =>
	tool({
		description: "Write content to a file. Creates the file and parent directories if needed.",
		inputSchema: z.object({
			path: z.string().describe("Path to file"),
			content: z.string().describe("Content to write"),
		}),
		execute: async (args): Promise<ToolResult> => {
			try {
				const filePath = resolve(cwd, args.path)
				await mkdir(dirname(filePath), { recursive: true })
				await writeFile(filePath, args.content)
				const relPath = getRelativeIfInside(cwd, filePath)
				return {
					content: [{ type: "text", text: `Wrote ${args.content.length} bytes → ${relPath}` }],
					isError: false,
				}
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error writing file: ${(e as Error).message}` }],
					isError: true,
				}
			}
		},
		toModelOutput: ({ output }) => toToolResultOutput(output),
	})

// Requires oldText to be unique to avoid ambiguous replacements.
export const editTool = (cwd: string) =>
	tool({
		description:
			"Edit a file using exact text replacement. Each edit's oldText must be unique in the file.",
		inputSchema: z.object({
			path: z.string().describe("Path to file"),
			edits: z
				.array(
					z.object({
						oldText: z.string().describe("Exact text to find (must be unique)"),
						newText: z.string().describe("Replacement text"),
					}),
				)
				.describe(
					"Array of {oldText, newText} replacements. oldText must be unique. Non-overlapping.",
				),
		}),
		execute: async (args): Promise<ToolResult> => {
			try {
				const filePath = resolve(cwd, args.path)
				let content: string
				try {
					content = await readFile(filePath, "utf-8")
				} catch {
					return {
						content: [{ type: "text", text: `File not found: ${args.path}` }],
						isError: true,
					}
				}
				const edits = args.edits

				// Validate all edits before applying any — avoids partial writes on bad input
				for (const edit of edits) {
					const count = content.split(edit.oldText).length - 1
					if (count === 0) {
						return {
							content: [
								{ type: "text", text: `oldText not found: "${edit.oldText.slice(0, 80)}…"` },
							],
							isError: true,
						}
					}
					// Ambiguous match would replace the wrong occurrence
					if (count > 1) {
						return {
							content: [
								{
									type: "text",
									text: `oldText found ${count} times — add surrounding context to make it unique: "${edit.oldText.slice(0, 60)}…"`,
								},
							],
							isError: true,
						}
					}
				}

				// Apply edits sequentially
				for (const edit of edits) {
					content = content.replace(edit.oldText, edit.newText)
				}

				await writeFile(filePath, content)
				const relPath = getRelativeIfInside(cwd, filePath)
				return {
					content: [
						{
							type: "text",
							text: `Edited ${relPath} (${edits.length} replacement${edits.length > 1 ? "s" : ""})`,
						},
					],
					isError: false,
				}
			} catch (e) {
				return {
					content: [{ type: "text", text: `Error editing file: ${(e as Error).message}` }],
					isError: true,
				}
			}
		},
		toModelOutput: ({ output }) => toToolResultOutput(output),
	})
