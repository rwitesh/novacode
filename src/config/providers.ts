import type { Model, ProviderDef } from "../types.ts"

export const PROVIDERS: ProviderDef[] = [
	{
		id: "glm",
		name: "GLM (Z.AI)",
		api: "openai",
		baseUrl: "https://api.z.ai/api/coding/paas/v4",
		envKey: "GLM_API_KEY",
	},
	{
		id: "gemini",
		name: "Gemini (Google)",
		api: "gemini",
		baseUrl: "https://generativelanguage.googleapis.com",
		envKey: "GEMINI_API_KEY",
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		api: "openai",
		baseUrl: "https://api.deepseek.com",
		envKey: "DEEPSEEK_API_KEY",
	},
	{
		id: "openai",
		name: "OpenAI",
		api: "openai",
		baseUrl: "https://api.openai.com/v1",
		envKey: "OPENAI_API_KEY",
	},
]

export const MODELS: Model[] = [
	// GLM
	{
		id: "glm-5.1",
		name: "GLM-5.1",
		provider: "glm",
		contextWindow: 128_000,
		maxTokens: 4096,
		supportsThinking: false,
	},
	{
		id: "glm-5",
		name: "GLM-5",
		provider: "glm",
		contextWindow: 128_000,
		maxTokens: 4096,
		supportsThinking: false,
	},
	{
		id: "glm-5-turbo",
		name: "GLM-5 Turbo",
		provider: "glm",
		contextWindow: 128_000,
		maxTokens: 4096,
		supportsThinking: false,
	},
	{
		id: "glm-4.7",
		name: "GLM-4.7",
		provider: "glm",
		contextWindow: 128_000,
		maxTokens: 4096,
		supportsThinking: false,
	},
	{
		id: "glm-4.7-flash",
		name: "GLM-4.7 Flash (Free)",
		provider: "glm",
		contextWindow: 128_000,
		maxTokens: 4096,
		supportsThinking: false,
	},
	{
		id: "glm-4.5-flash",
		name: "GLM-4.5 Flash (Free)",
		provider: "glm",
		contextWindow: 128_000,
		maxTokens: 4096,
		supportsThinking: false,
	},
	// Gemini
	{
		id: "gemini-3.5-flash",
		name: "Gemini 3.5 Flash",
		provider: "gemini",
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		supportsThinking: true,
	},
	{
		id: "gemini-3.1-pro-preview",
		name: "Gemini 3.1 Pro Preview",
		provider: "gemini",
		contextWindow: 2_000_000,
		maxTokens: 65_536,
		supportsThinking: true,
	},
	{
		id: "gemini-3.1-pro-preview-customtools",
		name: "Gemini 3.1 Pro (Custom Tools)",
		provider: "gemini",
		contextWindow: 2_000_000,
		maxTokens: 65_536,
		supportsThinking: true,
	},
	{
		id: "gemini-3.1-flash-lite",
		name: "Gemini 3.1 Flash-Lite",
		provider: "gemini",
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		supportsThinking: true,
	},
	{
		id: "gemini-3.1-flash-lite-preview",
		name: "Gemini 3.1 Flash-Lite Preview",
		provider: "gemini",
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		supportsThinking: true,
	},
	{
		id: "gemini-3-flash-preview",
		name: "Gemini 3 Flash Preview",
		provider: "gemini",
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		supportsThinking: true,
	},
	{
		id: "gemini-2.5-pro",
		name: "Gemini 2.5 Pro",
		provider: "gemini",
		contextWindow: 2_000_000,
		maxTokens: 65_536,
		supportsThinking: false,
	},
	{
		id: "gemini-2.5-flash",
		name: "Gemini 2.5 Flash",
		provider: "gemini",
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		supportsThinking: false,
	},
	{
		id: "gemini-2.5-flash-lite",
		name: "Gemini 2.5 Flash-Lite",
		provider: "gemini",
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		supportsThinking: false,
	},
	{
		id: "gemini-2.5-computer-use-preview-10-2025",
		name: "Gemini 2.5 Computer Use",
		provider: "gemini",
		contextWindow: 1_000_000,
		maxTokens: 65_536,
		supportsThinking: false,
	},
	// DeepSeek
	{
		id: "deepseek-chat",
		name: "DeepSeek V3",
		provider: "deepseek",
		contextWindow: 64_000,
		maxTokens: 8_192,
		supportsThinking: false,
	},
	{
		id: "deepseek-reasoner",
		name: "DeepSeek R1",
		provider: "deepseek",
		contextWindow: 64_000,
		maxTokens: 8_192,
		supportsThinking: true,
	},
	// OpenAI
	{
		id: "gpt-4o",
		name: "GPT-4o",
		provider: "openai",
		contextWindow: 128_000,
		maxTokens: 16_384,
		supportsThinking: false,
	},
	{
		id: "o4-mini",
		name: "o4-mini",
		provider: "openai",
		contextWindow: 200_000,
		maxTokens: 100_000,
		supportsThinking: true,
	},
]

export function getProvider(id: string): ProviderDef | undefined {
	return PROVIDERS.find((p) => p.id === id)
}

export function getModelsForProvider(providerId: string): Model[] {
	return MODELS.filter((m) => m.provider === providerId)
}
