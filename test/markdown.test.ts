import chalk from "chalk"
import { describe, expect, it } from "vitest"
import {
	formatMarkdown,
	MarkdownRenderer,
	StreamingMarkdownRenderer,
} from "../src/tui/markdown/index.ts"

chalk.level = 1

// biome-ignore lint/suspicious/noControlCharactersInRegex: standard ANSI escape sequence pattern
const ANSI = /\u001b\[[0-9;]*m/g
const strip = (s: string): string => s.replace(ANSI, "")

describe("MarkdownRenderer — code blocks", () => {
	it("renders a minimal language label header (no border box)", () => {
		const out = formatMarkdown("```ts\nconst x = 1\n```\n")
		const visible = strip(out)
		expect(visible).toContain("─ ts")
		expect(visible).not.toContain("┌")
		expect(visible).not.toContain("└")
		expect(visible).not.toContain("[Code:")
	})

	it("omits the header for an untagged fence", () => {
		const out = formatMarkdown("```\nplain\n```\n")
		const visible = strip(out)
		expect(visible).not.toContain("[Code:")
		expect(visible).not.toContain("─")
		expect(visible).toContain("plain")
	})

	it("indents code lines without a pipe gutter and applies no closing border", () => {
		const out = formatMarkdown("```ts\nconst x = 1\n```\n")
		const visible = strip(out)
		expect(visible).toContain("  const x = 1")
		expect(visible).not.toContain("│")
		expect(visible).not.toContain("└")
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
	})
})

describe("MarkdownRenderer — code syntax highlighting", () => {
	it("highlights keywords in a supported language", () => {
		const out = formatMarkdown("```ts\nconst x = 1\n```\n")
		expect(out).not.toContain("const x = 1")
		expect(strip(out)).toContain("const x = 1")
	})

	it("renders unsupported-language code dimmed", () => {
		const out = formatMarkdown("```text\n6 CO2 + 6 H2O\n```\n")
		const visible = strip(out)
		expect(visible).toContain("6 CO2 + 6 H2O")
	})
})

describe("MarkdownRenderer — inline formatting", () => {
	it("keeps inline code visible", () => {
		const out = strip(formatMarkdown("use `readFile` here"))
		expect(out).toContain("readFile")
		expect(out).not.toContain("`readFile`")
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

describe("MarkdownRenderer — tables are not specially rendered", () => {
	it("does not draw a bordered table box", () => {
		const md = ["| Name | Role |", "| --- | --- |", "| Nova | agent |"].join("\n")
		const visible = strip(formatMarkdown(md))
		expect(visible).not.toContain("┌")
		expect(visible).not.toContain("┬")
		expect(visible).not.toContain("┼")
		expect(visible).not.toContain("┤")
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

	it("returns cached output when called with the same text", () => {
		const stream = new StreamingMarkdownRenderer()
		const text = "hello world"
		const a = stream.update(text)
		const b = stream.update(text)
		expect(b).toBe(a)
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
