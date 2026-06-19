/**
 * Web tools for searching and fetching internet content.
 * Uses DuckDuckGo HTML for search (no API key needed) and Node's built-in
 * fetch for reading URLs.
 */
import { tool } from "ai"
import { z } from "zod"
import { toToolResultOutput } from "../content.ts"
import type { ToolResult } from "../types.ts"

const MAX_CONTENT = 50_000

// Minimal HTML → plaintext: strips tags, decodes entities, collapses whitespace
function stripRepeatedly(input: string, pattern: RegExp, replacement: string): string {
	let previous: string
	do {
		previous = input
		input = input.replace(pattern, replacement)
	} while (input !== previous)
	return input
}

function htmlToText(html: string): string {
	let text = html
	// Remove HTML comments (loop to handle nested/re-introduced patterns)
	text = stripRepeatedly(text, /<!--[\s\S]*?-->/g, "")
	// Remove script blocks (loop + tolerate whitespace in close tag like </script >)
	text = stripRepeatedly(text, /<script[\s\S]*?<\/script[^>]*>/gi, "")
	// Remove style blocks
	text = stripRepeatedly(text, /<style[\s\S]*?<\/style[^>]*>/gi, "")
	text = text
		// Keep link hrefs visible (supports single, double, or no quotes)
		.replace(/<a[^>]*href=["']?([^"'>\s]*)["']?[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
		// Block-level tags → newlines
		.replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|pre|hr)[^>]*>/gi, "\n")
		// Remove remaining tags
		.replace(/<[^>]+>/g, "")
		// Decode common HTML entities — decode &amp; LAST to avoid double-unescaping
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#34;/g, '"')
		.replace(/&#x22;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&#x27;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&ldquo;/g, '"')
		.replace(/&rdquo;/g, '"')
		.replace(/&lsquo;/g, "'")
		.replace(/&rsquo;/g, "'")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		// Collapse whitespace but keep paragraph breaks
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim()

	if (text.length > MAX_CONTENT) {
		text = `${text.slice(0, MAX_CONTENT)}\n…truncated`
	}
	return text
}

const USER_AGENT =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

export const webSearchTool = () =>
	tool({
		description:
			"Search the web using DuckDuckGo. Returns up to 10 results with titles, URLs, and snippets. Use this when you need information from the internet.",
		inputSchema: z.object({
			query: z.string().describe("Search query"),
		}),
		execute: async (args, { abortSignal }): Promise<ToolResult> => {
			const query = args.query
			if (!query.trim()) {
				return { content: [{ type: "text", text: "Error: empty search query" }], isError: true }
			}

			try {
				const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
				const resp = await fetch(url, {
					signal: abortSignal ?? undefined,
					headers: { "User-Agent": USER_AGENT },
				})

				if (!resp.ok) {
					return {
						content: [{ type: "text", text: `Search failed: HTTP ${resp.status}` }],
						isError: true,
					}
				}

				const html = await resp.text()

				// Split HTML into blocks by result__body to isolate each search result safely
				const containerRegex = /<div[^>]*class="[^"]*result__body[^"]*"[^>]*>/gi
				const indices: number[] = []
				for (const match of html.matchAll(containerRegex)) {
					if (match.index !== undefined) {
						indices.push(match.index)
					}
				}
				const blocks: string[] = []
				if (indices.length > 0) {
					for (let i = 0; i < indices.length; i++) {
						const start = indices[i]!
						const end = indices[i + 1] ?? html.length
						blocks.push(html.slice(start, end))
					}
				}

				const results: string[] = []
				const titleRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i
				const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i

				for (const block of blocks) {
					if (results.length >= 10) break

					const titleMatch = titleRegex.exec(block)
					if (!titleMatch) continue

					const rawUrl = titleMatch[1]!
					const title = htmlToText(titleMatch[2]!)

					const snippetMatch = snippetRegex.exec(block)
					const snippet = snippetMatch ? htmlToText(snippetMatch[1]!) : ""

					// DuckDuckGo wraps URLs through a redirect; extract the actual URL
					let cleanUrl = rawUrl
					try {
						const urlToParse = rawUrl.startsWith("//")
							? `https:${rawUrl}`
							: rawUrl.startsWith("/")
								? `https://duckduckgo.com${rawUrl}`
								: rawUrl
						const param = new URL(urlToParse).searchParams.get("uddg")
						if (param) cleanUrl = param
					} catch {
						// Not a redirect URL, use as-is
					}

					results.push(`## ${title}\n${cleanUrl}\n${snippet}`)
				}

				if (results.length === 0) {
					return { content: [{ type: "text", text: "No results found." }], isError: false }
				}

				return { content: [{ type: "text", text: results.join("\n\n") }], isError: false }
			} catch (e) {
				const msg = (e as Error).message
				if (msg.includes("abort")) {
					return { content: [{ type: "text", text: "Search aborted." }], isError: true }
				}
				return {
					content: [{ type: "text", text: `Search error: ${msg}` }],
					isError: true,
				}
			}
		},
		toModelOutput: ({ output }) => toToolResultOutput(output),
	})

export const webFetchTool = () =>
	tool({
		description:
			"Fetch and read the content of a web page. Returns the page text with HTML tags stripped. Useful for reading documentation, articles, or API references.",
		inputSchema: z.object({
			url: z.string().describe("URL to fetch"),
		}),
		execute: async (args, { abortSignal }): Promise<ToolResult> => {
			const url = args.url
			if (!url.trim()) {
				return { content: [{ type: "text", text: "Error: empty URL" }], isError: true }
			}

			try {
				new URL(url)
			} catch {
				return { content: [{ type: "text", text: `Error: invalid URL: ${url}` }], isError: true }
			}

			try {
				const resp = await fetch(url, {
					signal: abortSignal ?? undefined,
					headers: {
						"User-Agent": USER_AGENT,
						Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
					},
					redirect: "follow",
				})

				if (!resp.ok) {
					return {
						content: [
							{ type: "text", text: `Fetch failed: HTTP ${resp.status} ${resp.statusText}` },
						],
						isError: true,
					}
				}

				const contentType = (resp.headers.get("content-type") ?? "").toLowerCase()
				const body = await resp.text()

				// Sniff HTML: check content-type or if body has HTML markup signature
				const isHtml =
					contentType.includes("text/html") ||
					contentType.includes("application/xhtml+xml") ||
					body.trim().toLowerCase().startsWith("<!doctype html") ||
					body.trim().toLowerCase().startsWith("<html")

				if (isHtml) {
					return { content: [{ type: "text", text: htmlToText(body) }], isError: false }
				}

				// For plain text, JSON, etc. return as-is (truncated if needed)
				const truncated =
					body.length > MAX_CONTENT ? `${body.slice(0, MAX_CONTENT)}\n…truncated` : body
				return { content: [{ type: "text", text: truncated }], isError: false }
			} catch (e) {
				const msg = (e as Error).message
				if (msg.includes("abort")) {
					return { content: [{ type: "text", text: "Fetch aborted." }], isError: true }
				}
				return {
					content: [{ type: "text", text: `Fetch error: ${msg}` }],
					isError: true,
				}
			}
		},
		toModelOutput: ({ output }) => toToolResultOutput(output),
	})
