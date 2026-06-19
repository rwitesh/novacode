import type { Model, ProviderDef } from "../types.ts"

// Provider id constants — single source of truth for provider identifiers,
// referenced by both PROVIDERS and every entry in MODELS.
export const PROVIDER = {
	glm: "glm",
	gemini: "gemini",
	deepseek: "deepseek",
	openai: "openai",
	anthropic: "anthropic",
} as const

// Static provider data. Provider/model construction + reasoning defaults live
// in src/providers.ts. Adding a provider = one entry here + a createModel case.
export const PROVIDERS: ProviderDef[] = [
	{
		id: PROVIDER.glm,
		name: "GLM (Z.AI)",
		baseUrl: "https://api.z.ai/api/coding/paas/v4",
		envKey: "GLM_API_KEY",
	},
	{
		id: PROVIDER.gemini,
		name: "Gemini (Google)",
		baseUrl: "https://generativelanguage.googleapis.com",
		envKey: "GEMINI_API_KEY",
	},
	{
		id: PROVIDER.deepseek,
		name: "DeepSeek",
		baseUrl: "https://api.deepseek.com",
		envKey: "DEEPSEEK_API_KEY",
	},
	{
		id: PROVIDER.openai,
		name: "OpenAI",
		baseUrl: "https://api.openai.com/v1",
		envKey: "OPENAI_API_KEY",
	},
	{
		id: PROVIDER.anthropic,
		name: "Anthropic",
		baseUrl: "https://api.anthropic.com",
		envKey: "ANTHROPIC_API_KEY",
	},
]

// Model catalog. Each entry carries only what genuinely varies per model.
// Provider construction + HIGH reasoning defaults live in src/providers.ts.
// `reasoning` gates whether a reasoning providerOption is sent.
export const MODELS: Model[] = [
	// GLM
	{
		id: "glm-5.2",
		name: "GLM-5.2",
		provider: PROVIDER.glm,
		contextWindow: 1_000_000,
		maxOutput: 128_000,
		reasoning: true,
		default: true,
	},
	{
		id: "glm-5.1",
		name: "GLM-5.1",
		provider: PROVIDER.glm,
		contextWindow: 128_000,
		maxOutput: 4096,
		reasoning: false,
	},
	{
		id: "glm-5-turbo",
		name: "GLM-5 Turbo",
		provider: PROVIDER.glm,
		contextWindow: 128_000,
		maxOutput: 4096,
		reasoning: false,
	},
	// Gemini
	{
		id: "gemini-3.5-flash",
		name: "Gemini 3.5 Flash",
		provider: PROVIDER.gemini,
		contextWindow: 1_000_000,
		maxOutput: 65_536,
		reasoning: true,
		default: true,
	},
	{
		id: "gemini-3.1-pro-preview",
		name: "Gemini 3.1 Pro Preview",
		provider: PROVIDER.gemini,
		contextWindow: 2_000_000,
		maxOutput: 65_536,
		reasoning: true,
	},
	{
		id: "gemini-3.1-pro-preview-customtools",
		name: "Gemini 3.1 Pro (Custom Tools)",
		provider: PROVIDER.gemini,
		contextWindow: 2_000_000,
		maxOutput: 65_536,
		reasoning: true,
	},
	{
		id: "gemini-3.1-flash-lite",
		name: "Gemini 3.1 Flash-Lite",
		provider: PROVIDER.gemini,
		contextWindow: 1_000_000,
		maxOutput: 65_536,
		reasoning: true,
	},
	// DeepSeek
	{
		id: "deepseek-v4-flash",
		name: "DeepSeek V4 Flash",
		provider: PROVIDER.deepseek,
		contextWindow: 1_000_000,
		maxOutput: 16_384,
		reasoning: true,
		default: true,
	},
	{
		id: "deepseek-v4-pro",
		name: "DeepSeek V4 Pro",
		provider: PROVIDER.deepseek,
		contextWindow: 1_000_000,
		maxOutput: 16_384,
		reasoning: true,
	},
	// OpenAI
	{
		id: "gpt-5.5",
		name: "GPT-5.5",
		provider: PROVIDER.openai,
		contextWindow: 1_000_000,
		maxOutput: 128_000,
		reasoning: true,
		default: true,
	},
	{
		id: "gpt-5.5-pro",
		name: "GPT-5.5 Pro",
		provider: PROVIDER.openai,
		contextWindow: 1_000_000,
		maxOutput: 128_000,
		reasoning: true,
	},
	{
		id: "gpt-5.4",
		name: "GPT-5.4",
		provider: PROVIDER.openai,
		contextWindow: 1_000_000,
		maxOutput: 128_000,
		reasoning: true,
	},
	{
		id: "gpt-5.4-pro",
		name: "GPT-5.4 Pro",
		provider: PROVIDER.openai,
		contextWindow: 1_000_000,
		maxOutput: 128_000,
		reasoning: true,
	},
	{
		id: "gpt-5.4-mini",
		name: "GPT-5.4 Mini",
		provider: PROVIDER.openai,
		contextWindow: 400_000,
		maxOutput: 128_000,
		reasoning: true,
	},
	{
		id: "gpt-5.4-nano",
		name: "GPT-5.4 Nano",
		provider: PROVIDER.openai,
		contextWindow: 400_000,
		maxOutput: 128_000,
		reasoning: true,
	},
	// Anthropic
	{
		id: "claude-fable-5",
		name: "Claude Fable 5",
		provider: PROVIDER.anthropic,
		contextWindow: 1_000_000,
		maxOutput: 128_000,
		reasoning: true,
	},
	{
		id: "claude-opus-4-8",
		name: "Claude 4.8 Opus",
		provider: PROVIDER.anthropic,
		contextWindow: 200_000,
		maxOutput: 64_000,
		reasoning: true,
		default: true,
	},
	{
		id: "claude-opus-4-7",
		name: "Claude 4.7 Opus",
		provider: PROVIDER.anthropic,
		contextWindow: 200_000,
		maxOutput: 64_000,
		reasoning: true,
	},
	{
		id: "claude-opus-4-6",
		name: "Claude 4.6 Opus",
		provider: PROVIDER.anthropic,
		contextWindow: 200_000,
		maxOutput: 32_000,
		reasoning: true,
	},
	{
		id: "claude-opus-4-5",
		name: "Claude 4.5 Opus",
		provider: PROVIDER.anthropic,
		contextWindow: 200_000,
		maxOutput: 32_000,
		reasoning: true,
	},
	{
		id: "claude-sonnet-4-6",
		name: "Claude 4.6 Sonnet",
		provider: PROVIDER.anthropic,
		contextWindow: 200_000,
		maxOutput: 32_000,
		reasoning: true,
	},
	{
		id: "claude-sonnet-4-5",
		name: "Claude 4.5 Sonnet",
		provider: PROVIDER.anthropic,
		contextWindow: 200_000,
		maxOutput: 32_000,
		reasoning: true,
	},
]

export function getProvider(id: string): ProviderDef | undefined {
	return PROVIDERS.find((p) => p.id === id)
}

export function getModelsForProvider(providerId: string): Model[] {
	return MODELS.filter((m) => m.provider === providerId)
}

// Returns a provider's default model (flagged default: true), falling back to
// the first listed model.
export function getDefaultModel(providerId: string): Model | undefined {
	const models = getModelsForProvider(providerId)
	return models.find((m) => m.default) ?? models[0]
}
