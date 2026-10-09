import chalk from "chalk"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	formatMarkdown,
	MarkdownRenderer,
	StreamingMarkdownRenderer,
} from "../src/tui/markdown/index.ts"

const colorLevel = chalk.level
beforeAll(() => {
	chalk.level = 1
})
afterAll(() => {
	chalk.level = colorLevel
})

// biome-ignore lint/suspicious/noControlCharactersInRegex: standard ANSI escape sequence pattern
const ANSI = /\u001b\[[0-9;]*m/g
const strip = (s: string): string => s.replace(ANSI, "")

describe("MarkdownRenderer — code blocks", () => {
	it("renders a language label header", () => {
		const out = formatMarkdown("```ts\nconst x = 1\n```\n")
		expect(strip(out)).toContain("─ ts")
	})

	it("omits the header for an untagged fence", () => {
		const out = formatMarkdown("```\nplain\n```\n")
		const visible = strip(out)
		expect(visible).not.toContain("─")
		expect(visible).toContain("plain")
	})

	it("indents code lines", () => {
		const out = formatMarkdown("```ts\nconst x = 1\n```\n")
		expect(strip(out)).toContain("  const x = 1")
	})

	it("keeps multiple code blocks independent", () => {
		const out = formatMarkdown("```js\na\n```\n\n```py\nb\n```\n")
		const visible = strip(out)
		expect(visible).toContain("─ js")
		expect(visible).toContain("─ py")
		expect(visible).toContain("  a")
		expect(visible).toContain("  b")
	})

	it("carries fence state across chunks via the constructor seed", () => {
		const r = new MarkdownRenderer()
		const first = r.renderChunk("```ts\nconst a = 1\n")
		const state = r.getState()
		expect(state.inCodeBlock).toBe(true)
		expect(state.codeBlockLang).toBe("ts")

		const cont = new MarkdownRenderer(state)
		const second = cont.renderChunk("const b = 2\n```\n")
		const visible = strip(first + second)
		expect(visible).toContain("  const a = 1")
		expect(visible).toContain("  const b = 2")
		expect(cont.getState().inCodeBlock).toBe(false)
		expect(first + second).toBe(formatMarkdown("```ts\nconst a = 1\nconst b = 2\n```\n"))
	})
})

describe("MarkdownRenderer — code syntax highlighting", () => {
	it("highlights keywords in a supported language", () => {
		const out = formatMarkdown("```ts\nconst x = 1\n```\n")
		expect(out).not.toContain("const x = 1")
		expect(strip(out)).toContain("const x = 1")
	})
})

describe("MarkdownRenderer — inline formatting", () => {
	it.each(["foo_bar_baz", "**literal**", "[x](url)"])(
		"preserves literal syntax in inline code: %s",
		(code) => {
			expect(strip(formatMarkdown(`use \`${code}\` here`))).toBe(`use ${code} here`)
		},
	)
	it.each([
		["**bold and _italic_**", "bold and italic"],
		["*use `foo_bar_baz`*", "use foo_bar_baz"],
		["[**docs**](https://example.com/foo_bar_baz)", "docs (https://example.com/foo_bar_baz)"],
	])("renders nested inline formatting without reparsing styled output", (markdown, visible) => {
		expect(strip(formatMarkdown(markdown))).toBe(visible)
	})

	it("keeps bold and italic markers off the visible text", () => {
		const out = strip(formatMarkdown("**bold** and *italic*"))
		expect(out).toContain("bold")
		expect(out).toContain("italic")
		expect(out).not.toContain("**bold**")
		expect(out).not.toContain("*italic*")
	})

	it("renders links as label plus url", () => {
		const visible = strip(formatMarkdown("[docs](https://example.com)"))
		expect(visible).toContain("docs")
		expect(visible).toContain("(https://example.com)")
	})
})

describe("MarkdownRenderer — block elements", () => {
	it("renders headings", () => {
		const visible = strip(formatMarkdown("# Title\n## Sub\n### Deep"))
		expect(visible).toContain("Title")
		expect(visible).toContain("Sub")
		expect(visible).toContain("Deep")
	})

	it("renders bullet list items with a marker", () => {
		const visible = strip(formatMarkdown("- one\n- two"))
		expect(visible).toContain("•")
		expect(visible).toContain("one")
		expect(visible).toContain("two")
		expect(visible).not.toContain("- one")
	})
})

describe("MarkdownRenderer — fence delimiters", () => {
	it.each([
		["```text\n~~~\n**literal**\n```\nAfter", "  ~~~\n  **literal**\n\nAfter"],
		["````text\n```\n**literal**\n````\nAfter", "  ```\n  **literal**\n\nAfter"],
		[
			"```text\n```not a close\n**literal**\n```\nAfter",
			"  ```not a close\n  **literal**\n\nAfter",
		],
	])("only closes matching fences", (text, expected) => {
		expect(strip(formatMarkdown(text))).toContain(expected)
		const stream = new StreamingMarkdownRenderer()
		for (let i = 1; i <= text.length; i++) {
			expect(strip(stream.update(text.slice(0, i)))).toBe(strip(formatMarkdown(text.slice(0, i))))
		}
	})
})

describe("StreamingMarkdownRenderer", () => {
	it("produces the same output as a full render once the stream settles", () => {
		const full = "# Heading\n\nSome `code` here.\n\n```ts\nconst x = 1\n```\n"
		const stream = new StreamingMarkdownRenderer()
		let out = ""
		for (let i = 1; i <= full.length; i++) {
			out = stream.update(full.slice(0, i))
		}
		expect(strip(out)).toEqual(strip(formatMarkdown(full)))
	})

	it("can be reset to start fresh", () => {
		const stream = new StreamingMarkdownRenderer()
		stream.update("# old heading")
		stream.reset()
		const out = strip(stream.update("# new heading"))
		expect(out).toContain("new heading")
		expect(out).not.toContain("old heading")
	})
})
