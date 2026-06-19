import type { Model, ProviderDef } from "../types.ts"

// Provider id constants — single source of truth for provider identifiers.
export const PROVIDER = {
	glm: "glm",
	gemini: "gemini",
	deepseek: "deepseek",
	openai: "openai",
	anthropic: "anthropic",
} as const

// Providers and their coding-capable models, grouped per provider. Context
// windows are sourced from the Vercel AI Gateway model catalog. Provider/model
// construction + reasoning defaults live in src/providers.ts.
//
// Each provider marks one model `default: true`.
export const PROVIDERS: ProviderDef[] = [
	{
		id: PROVIDER.glm,
		name: "GLM (Z.AI)",
		baseUrl: "https://api.z.ai/api/coding/paas/v4",
		envKey: "GLM_API_KEY",
		models: [
			{ id: "glm-5.2", contextWindow: 1_040_000, reasoning: true, default: true },
			{ id: "glm-5.1", contextWindow: 204_800, reasoning: true },
			{ id: "glm-5-turbo", contextWindow: 202_800, reasoning: true },
			{ id: "glm-5", contextWindow: 202_800, reasoning: true },
			{ id: "glm-4.7", contextWindow: 204_800, reasoning: true },
			{ id: "glm-4.6", contextWindow: 204_800, reasoning: true },
			{ id: "glm-4.5", contextWindow: 131_072, reasoning: true },
			{ id: "glm-4.5-air", contextWindow: 128_000, reasoning: true },
		],
	},
	{
		id: PROVIDER.gemini,
		name: "Gemini (Google)",
		baseUrl: "https://generativelanguage.googleapis.com",
		envKey: "GEMINI_API_KEY",
		models: [
			{ id: "gemini-3.5-flash", contextWindow: 1_000_000, reasoning: true, default: true },
			{ id: "gemini-3.1-pro-preview", contextWindow: 1_000_000, reasoning: true },
			{ id: "gemini-3.1-flash-lite", contextWindow: 1_000_000, reasoning: true },
			{ id: "gemini-3-flash", contextWindow: 1_000_000, reasoning: true },
			{ id: "gemini-2.5-pro", contextWindow: 1_048_576, reasoning: true },
			{ id: "gemini-2.5-flash", contextWindow: 1_000_000, reasoning: true },
			{ id: "gemini-2.5-flash-lite", contextWindow: 1_048_576, reasoning: true },
		],
	},
	{
		id: PROVIDER.deepseek,
		name: "DeepSeek",
		baseUrl: "https://api.deepseek.com",
		envKey: "DEEPSEEK_API_KEY",
		models: [
			{ id: "deepseek-v4-flash", contextWindow: 1_048_576, reasoning: true, default: true },
			{ id: "deepseek-v4-pro", contextWindow: 1_048_600, reasoning: true },
			{ id: "deepseek-v3.2", contextWindow: 163_842, reasoning: true },
			{ id: "deepseek-v3.2-thinking", contextWindow: 163_842, reasoning: true },
			{ id: "deepseek-v3.1", contextWindow: 163_840, reasoning: true },
			{ id: "deepseek-v3.1-terminus", contextWindow: 131_072, reasoning: true },
		],
	},
	{
		id: PROVIDER.openai,
		name: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		envKey: "OPENAI_API_KEY",
		models: [
			{ id: "gpt-5.5", contextWindow: 1_000_000, reasoning: true, default: true },
			{ id: "gpt-5.5-pro", contextWindow: 1_000_000, reasoning: true },
			{ id: "gpt-5.4", contextWindow: 1_050_000, reasoning: true },
			{ id: "gpt-5.4-pro", contextWindow: 1_050_000, reasoning: true },
			{ id: "gpt-5.4-mini", contextWindow: 400_000, reasoning: true },
			{ id: "gpt-5.4-nano", contextWindow: 400_000, reasoning: true },
			{ id: "gpt-5.3-codex", contextWindow: 400_000, reasoning: true },
			{ id: "gpt-5.2", contextWindow: 400_000, reasoning: true },
			{ id: "gpt-5.2-pro", contextWindow: 400_000, reasoning: true },
			{ id: "gpt-5.2-codex", contextWindow: 400_000, reasoning: true },
			{ id: "gpt-5.1-codex", contextWindow: 400_000, reasoning: true },
			{ id: "gpt-5.1-codex-max", contextWindow: 400_000, reasoning: true },
			{ id: "gpt-5.1-codex-mini", contextWindow: 400_000, reasoning: true },
			{ id: "gpt-5-codex", contextWindow: 400_000, reasoning: true },
			{ id: "gpt-5", contextWindow: 400_000, reasoning: true },
			{ id: "gpt-5-mini", contextWindow: 400_000, reasoning: true },
			{ id: "gpt-5-nano", contextWindow: 400_000, reasoning: true },
			{ id: "gpt-oss-120b", contextWindow: 131_072, reasoning: true },
			{ id: "gpt-oss-20b", contextWindow: 131_072, reasoning: true },
		],
	},
	{
		id: PROVIDER.anthropic,
		name: "Anthropic",
		baseUrl: "https://api.anthropic.com",
		envKey: "ANTHROPIC_API_KEY",
		models: [
			{ id: "claude-fable-5", contextWindow: 1_000_000, reasoning: true },
			{ id: "claude-opus-4-8", contextWindow: 1_000_000, reasoning: true, default: true },
			{ id: "claude-opus-4-7", contextWindow: 1_000_000, reasoning: true },
			{ id: "claude-sonnet-4-6", contextWindow: 1_000_000, reasoning: true },
			{ id: "claude-opus-4-6", contextWindow: 1_000_000, reasoning: true },
			{ id: "claude-haiku-4-5", contextWindow: 200_000, reasoning: true },
			{ id: "claude-sonnet-4-5", contextWindow: 1_000_000, reasoning: true },
			{ id: "claude-opus-4-5", contextWindow: 200_000, reasoning: true },
			{ id: "claude-opus-4-1", contextWindow: 200_000, reasoning: true },
			{ id: "claude-sonnet-4", contextWindow: 1_000_000, reasoning: true },
			{ id: "claude-opus-4", contextWindow: 200_000, reasoning: true },
		],
	},
]

export function getProvider(id: string): ProviderDef | undefined {
	return PROVIDERS.find((p) => p.id === id)
}

// Resolves a provider's nested models into the runtime Model shape (provider
// id attached).
export function getModelsForProvider(providerId: string): Model[] {
	const provider = getProvider(providerId)
	if (!provider) return []
	return provider.models.map((m) => ({ ...m, provider: provider.id }))
}

export function getModel(providerId: string, modelId: string): Model | undefined {
	return getModelsForProvider(providerId).find((m) => m.id === modelId)
}

// First match across all providers — used when only a model id is known.
export function getModelById(modelId: string): Model | undefined {
	for (const provider of PROVIDERS) {
		const model = getModel(provider.id, modelId)
		if (model) return model
	}
	return undefined
}

// A provider's default model (the entry flagged default: true), falling back to
// the first listed model.
export function getDefaultModel(providerId: string): Model | undefined {
	const models = getModelsForProvider(providerId)
	return models.find((m) => m.default) ?? models[0]
}
