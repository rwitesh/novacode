import chalk from "chalk"
import { describe, expect, it } from "vitest"
import { highlightCode, isHighlightable } from "../src/tui/markdown/syntax.ts"

chalk.level = 1

// biome-ignore lint/suspicious/noControlCharactersInRegex: standard ANSI escape sequence pattern
const ANSI = /\u001b\[[0-9;]*m/g
const strip = (s: string): string => s.replace(ANSI, "")

describe("isHighlightable", () => {
	it("recognizes supported langs and aliases", () => {
		expect(isHighlightable("ts")).toBe(true)
		expect(isHighlightable("js")).toBe(true)
		expect(isHighlightable("typescript")).toBe(true)
		expect(isHighlightable("python")).toBe(true)
		expect(isHighlightable("bash")).toBe(true)
		expect(isHighlightable("rs")).toBe(true)
		expect(isHighlightable("go")).toBe(true)
	})

	it("rejects unsupported and empty langs", () => {
		expect(isHighlightable("text")).toBe(false)
		expect(isHighlightable("whatever")).toBe(false)
		expect(isHighlightable("")).toBe(false)
	})
})

describe("highlightCode", () => {
	it("returns the line unchanged for unsupported langs", () => {
		expect(highlightCode("const x = 1", "text")).toBe("const x = 1")
	})

	it("keeps visible text intact after stripping color codes", () => {
		expect(strip(highlightCode("const x = 'hi' + 42", "ts"))).toBe("const x = 'hi' + 42")
	})

	it("paints a whole-line comment gray", () => {
		const out = highlightCode("// hello", "ts")
		expect(strip(out)).toBe("// hello")
		expect(out).not.toBe("// hello")
	})

	it("treats # as a python comment", () => {
		const out = highlightCode("# comment", "py")
		expect(strip(out)).toBe("# comment")
		expect(out).not.toBe("# comment")
	})

	it("wraps keywords, strings, and numbers with color codes", () => {
		const src = `const x = 'hi' + 42`
		const out = highlightCode(src, "ts")
		expect(out).not.toBe(src)
		expect(strip(out)).toBe(src)
	})

	it("highlights shell keywords", () => {
		const out = highlightCode("if [ -f file ]; then", "sh")
		expect(strip(out)).toBe("if [ -f file ]; then")
		expect(out).not.toBe("if [ -f file ]; then")
	})
})
