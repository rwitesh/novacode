import { describe, expect, it } from "vitest"
import { PROVIDERS } from "../src/models/catalog.ts"
import {
	getDefaultModel,
	getModel,
	getModelById,
	getModelsForProvider,
	getProvider,
} from "../src/models/lookup.ts"

describe("catalog: providers", () => {
	it("every provider has an id, name, envKey, and models", () => {
		for (const p of PROVIDERS) {
			expect(p.id).toBeTruthy()
			expect(p.name).toBeTruthy()
			expect(p.envKey).toBeTruthy()
			expect(p.models.length).toBeGreaterThan(0)
		}
	})
})

describe("catalog: defaults", () => {
	it("every provider has exactly one default-flagged model", () => {
		for (const p of PROVIDERS) {
			const defaults = p.models.filter((m) => m.default)
			expect(defaults, `${p.id} must have one default`).toHaveLength(1)
		}
	})

	it("getDefaultModel returns the flagged default", () => {
		for (const p of PROVIDERS) {
			const def = getDefaultModel(p.id)
			expect(def?.id).toBe(p.models.find((m) => m.default)?.id)
			expect(def?.provider).toBe(p.id)
		}
	})
})

describe("catalog: anthropic ordering", () => {
	it("lists claude-fable-5 first and defaults to claude-opus-4-8", () => {
		const models = getModelsForProvider("anthropic")
		expect(models[0]?.id).toBe("claude-fable-5")
		expect(getDefaultModel("anthropic")?.id).toBe("claude-opus-4-8")
	})
})

describe("catalog: model entries", () => {
	it("every model has a positive context window and a reasoning flag", () => {
		for (const p of PROVIDERS) {
			for (const m of p.models) {
				expect(m.contextWindow, `${p.id}/${m.id}`).toBeGreaterThan(0)
				expect(typeof m.reasoning, `${p.id}/${m.id}`).toBe("boolean")
			}
		}
	})

	it("model ids are unique within a provider", () => {
		for (const p of PROVIDERS) {
			const ids = p.models.map((m) => m.id)
			expect(new Set(ids).size, `${p.id} has duplicate ids`).toBe(ids.length)
		}
	})
})

describe("catalog: accessors", () => {
	it("getModelsForProvider attaches provider id", () => {
		const models = getModelsForProvider("openai")
		expect(models.length).toBeGreaterThan(0)
		expect(models.every((m) => m.provider === "openai")).toBe(true)
	})

	it("getModelsForProvider returns [] for unknown provider", () => {
		expect(getModelsForProvider("nope")).toEqual([])
	})

	it("getModel resolves a provider+id pair", () => {
		const m = getModel("openai", "gpt-5.5")
		expect(m?.id).toBe("gpt-5.5")
		expect(m?.provider).toBe("openai")
	})

	it("getModel returns undefined for unknown id", () => {
		expect(getModel("openai", "nope")).toBeUndefined()
	})

	it("getModelById searches across providers", () => {
		const m = getModelById("claude-fable-5")
		expect(m?.provider).toBe("anthropic")
		expect(m?.id).toBe("claude-fable-5")
	})

	it("getModelById returns undefined for unknown id", () => {
		expect(getModelById("nope")).toBeUndefined()
	})

	it("getProvider resolves known and unknown ids", () => {
		expect(getProvider("glm")?.id).toBe("glm")
		expect(getProvider("nope")).toBeUndefined()
	})
})
