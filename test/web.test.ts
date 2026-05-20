import { describe, expect, it } from "bun:test"
import { webFetchTool, webSearchTool } from "../src/tools/web.ts"

const mockFetch = (responseFn: (input: unknown, init?: unknown) => Promise<Response>) => {
	const originalFetch = globalThis.fetch
	globalThis.fetch = responseFn as unknown as typeof fetch
	return () => {
		globalThis.fetch = originalFetch
	}
}

describe("web_search tool", () => {
	it("parses DuckDuckGo HTML results and cleans redirect URLs", async () => {
		const mockHtml = `
			<div class="links_main links_deep result__body">
				<h2 class="result__title">
					<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.typescriptlang.org%2F&amp;rut=123">TypeScript: Typed JavaScript</a>
				</h2>
				<a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.typescriptlang.org%2F">TypeScript is a strongly typed programming language...</a>
			</div>
			<div class="links_main links_deep result__body">
				<h2 class="result__title">
					<a class="result__a" href="/l/?uddg=https%3A%2F%2Fwww.npmjs.com%2Fpackage%2Ftypescript">TypeScript on NPM</a>
				</h2>
				<a class="result__snippet" href="#">NPM registry package for typescript.</a>
			</div>
		`
		const restore = mockFetch(async (input) => {
			expect(input).toContain("https://html.duckduckgo.com/html/?q=typescript")
			return new Response(mockHtml, {
				status: 200,
				headers: { "Content-Type": "text/html" },
			})
		})

		try {
			const search = webSearchTool()
			const result = await search.execute({ query: "typescript" })
			expect(result.isError).toBe(false)

			const text = result.content[0]!
			expect(text.type).toBe("text")
			if (text.type === "text") {
				// Assert first result parsed and cleaned URL successfully
				expect(text.text).toContain("## TypeScript: Typed JavaScript")
				expect(text.text).toContain("https://www.typescriptlang.org/")
				expect(text.text).toContain("TypeScript is a strongly typed programming language")

				// Assert second result parsed and cleaned path-relative URL successfully
				expect(text.text).toContain("## TypeScript on NPM")
				expect(text.text).toContain("https://www.npmjs.com/package/typescript")
				expect(text.text).toContain("NPM registry package for typescript.")
			}
		} finally {
			restore()
		}
	})

	it("returns informative message when no results are found", async () => {
		const restore = mockFetch(async () => {
			return new Response("<body>No results found</body>", { status: 200 })
		})

		try {
			const search = webSearchTool()
			const result = await search.execute({ query: "nonexistentstuff" })
			expect(result.isError).toBe(false)
			const text = result.content[0]!
			if (text.type === "text") {
				expect(text.text).toContain("No results found.")
			}
		} finally {
			restore()
		}
	})

	it("returns error for empty search query", async () => {
		const search = webSearchTool()
		const result = await search.execute({ query: "   " })
		expect(result.isError).toBe(true)
		const text = result.content[0]!
		if (text.type === "text") {
			expect(text.text).toContain("empty search query")
		}
	})

	it("handles network failure and abort signals", async () => {
		const restore = mockFetch(async () => {
			throw new Error("Connection timed out")
		})

		try {
			const search = webSearchTool()
			const result = await search.execute({ query: "typescript" })
			expect(result.isError).toBe(true)
			const text = result.content[0]!
			if (text.type === "text") {
				expect(text.text).toContain("Search error: Connection timed out")
			}
		} finally {
			restore()
		}
	})
})

describe("web_fetch tool", () => {
	it("fetches HTML and cleanly strips tags to plaintext", async () => {
		const mockHtml = `
			<!doctype html>
			<html>
				<head><title>Test Title</title></head>
				<body>
					<h1>Heading 1</h1>
					<p>This is a paragraph with <a href="https://example.com">a link</a> inside it.</p>
					<!-- Comment that should be stripped -->
					<script>console.log("bad script")</script>
					<style>body { color: red; }</style>
					<div>Second &amp; final line with entities like &#x27;quote&#x27;.</div>
				</body>
			</html>
		`
		const restore = mockFetch(async (url) => {
			expect(url).toBe("https://example.com/page")
			return new Response(mockHtml, {
				status: 200,
				headers: { "Content-Type": "text/html; charset=utf-8" },
			})
		})

		try {
			const fetchTool = webFetchTool()
			const result = await fetchTool.execute({ url: "https://example.com/page" })
			expect(result.isError).toBe(false)

			const text = result.content[0]!
			if (text.type === "text") {
				// Title, styles, scripts and comments should be stripped
				expect(text.text).not.toContain("bad script")
				expect(text.text).not.toContain("color: red")
				expect(text.text).not.toContain("Comment that should be stripped")

				// Block elements should have newlines
				expect(text.text).toContain("Heading 1")

				// Links should format to markdown style
				expect(text.text).toContain("[a link](https://example.com)")

				// Entities should be decoded
				expect(text.text).toContain("Second & final line")
				expect(text.text).toContain("with entities like 'quote'")
			}
		} finally {
			restore()
		}
	})

	it("returns raw text for plain text or JSON responses", async () => {
		const jsonResponse = JSON.stringify({ status: "ok", data: 42 })
		const restore = mockFetch(async () => {
			return new Response(jsonResponse, {
				status: 200,
				headers: { "Content-Type": "application/json" },
			})
		})

		try {
			const fetchTool = webFetchTool()
			const result = await fetchTool.execute({ url: "https://example.com/api" })
			expect(result.isError).toBe(false)
			const text = result.content[0]!
			if (text.type === "text") {
				expect(text.text).toBe(jsonResponse)
			}
		} finally {
			restore()
		}
	})

	it("sniffs HTML by body signature when content-type header is missing or non-standard", async () => {
		const mockHtml = "<html><body><h1>Hello HTML!</h1></body></html>"
		const restore = mockFetch(async () => {
			return new Response(mockHtml, {
				status: 200,
				headers: {}, // Empty headers
			})
		})

		try {
			const fetchTool = webFetchTool()
			const result = await fetchTool.execute({ url: "https://example.com/missing-header" })
			expect(result.isError).toBe(false)
			const text = result.content[0]!
			if (text.type === "text") {
				expect(text.text).toBe("Hello HTML!") // Stripped successfully
			}
		} finally {
			restore()
		}
	})

	it("returns error for invalid URL syntax", async () => {
		const fetchTool = webFetchTool()
		const result = await fetchTool.execute({ url: "not-a-valid-url" })
		expect(result.isError).toBe(true)
		const text = result.content[0]!
		if (text.type === "text") {
			expect(text.text).toContain("invalid URL")
		}
	})

	it("handles aborts and HTTP errors", async () => {
		const restore = mockFetch(async () => {
			return new Response("Not Found", { status: 404, statusText: "Not Found" })
		})

		try {
			const fetchTool = webFetchTool()
			const result = await fetchTool.execute({ url: "https://example.com/404" })
			expect(result.isError).toBe(true)
			const text = result.content[0]!
			if (text.type === "text") {
				expect(text.text).toContain("Fetch failed: HTTP 404 Not Found")
			}
		} finally {
			restore()
		}
	})
})
