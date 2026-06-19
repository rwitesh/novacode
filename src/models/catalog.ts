import type { ProviderDef } from "../types.ts"

// Provider id constants — single source of truth for provider identifiers.
export const PROVIDER = {
	glm: "glm",
	gemini: "gemini",
	deepseek: "deepseek",
	openai: "openai",
	anthropic: "anthropic",
} as const

// Providers and their coding-capable models, grouped per provider. Context
// windows are sourced from the Vercel AI Gateway model catalog. This file is
// the static catalog of provider/model data only — lookups live in
// src/models/lookup.ts, and provider/model construction + reasoning defaults
// live in src/providers.ts.
//
// Each provider marks one model `default: true`.
//
// `reasoning: false` marks models that are active but reject the SDK's HIGH
// reasoning option (Anthropic `effort`, Google `thinkingLevel`). They stay
// usable — NovaCode sends no reasoning providerOption for them.
export const PROVIDERS: ProviderDef[] = [
	{
		id: PROVIDER.glm,
		name: "GLM (Z.AI)",
		envKey: "GLM_API_KEY",
		models: [
			{ id: "glm-5.2", contextWindow: 1_000_000, reasoning: true, default: true },
			{ id: "glm-5.1", contextWindow: 204_800, reasoning: true },
			{ id: "glm-5-turbo", contextWindow: 202_800, reasoning: true },
			{ id: "glm-5", contextWindow: 202_800, reasoning: true },
			{ id: "glm-4.7", contextWindow: 204_800, reasoning: true },
			{ id: "glm-4.6", contextWindow: 204_800, reasoning: true },
		],
	},
	{
		id: PROVIDER.gemini,
		name: "Gemini (Google)",
		envKey: "GEMINI_API_KEY",
		models: [
			{ id: "gemini-3.5-flash", contextWindow: 1_000_000, reasoning: true, default: true },
			{ id: "gemini-3.1-pro-preview", contextWindow: 1_000_000, reasoning: true },
			{ id: "gemini-3.1-flash-lite", contextWindow: 1_000_000, reasoning: true },
			{ id: "gemini-2.5-pro", contextWindow: 1_000_000, reasoning: false },
			{ id: "gemini-2.5-flash", contextWindow: 1_000_000, reasoning: false },
			{ id: "gemini-2.5-flash-lite", contextWindow: 1_000_000, reasoning: false },
		],
	},
	{
		id: PROVIDER.deepseek,
		name: "DeepSeek",
		envKey: "DEEPSEEK_API_KEY",
		models: [
			{ id: "deepseek-v4-flash", contextWindow: 1_000_000, reasoning: true, default: true },
			{ id: "deepseek-v4-pro", contextWindow: 1_000_000, reasoning: true },
		],
	},
	{
		id: PROVIDER.openai,
		name: "OpenAI",
		envKey: "OPENAI_API_KEY",
		models: [
			{ id: "gpt-5.5", contextWindow: 1_000_000, reasoning: true, default: true },
			{ id: "gpt-5.5-pro", contextWindow: 1_000_000, reasoning: true },
			{ id: "gpt-5.4", contextWindow: 1_000_000, reasoning: true },
			{ id: "gpt-5.4-pro", contextWindow: 1_000_000, reasoning: true },
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
		],
	},
	{
		id: PROVIDER.anthropic,
		name: "Anthropic",
		envKey: "ANTHROPIC_API_KEY",
		models: [
			{ id: "claude-fable-5", contextWindow: 1_000_000, reasoning: true },
			{ id: "claude-opus-4-8", contextWindow: 1_000_000, reasoning: true, default: true },
			{ id: "claude-opus-4-7", contextWindow: 1_000_000, reasoning: true },
			{ id: "claude-sonnet-4-6", contextWindow: 1_000_000, reasoning: true },
			{ id: "claude-opus-4-6", contextWindow: 1_000_000, reasoning: true },
			{ id: "claude-haiku-4-5", contextWindow: 200_000, reasoning: false },
			{ id: "claude-sonnet-4-5", contextWindow: 1_000_000, reasoning: false },
			{ id: "claude-opus-4-5", contextWindow: 200_000, reasoning: true },
			{ id: "claude-opus-4-1", contextWindow: 200_000, reasoning: false },
		],
	},
]
