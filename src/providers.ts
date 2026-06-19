/**
 * AI SDK provider factory + reasoning defaults.
 *
 * Replaces the entire former `src/llm/` layer (custom SSE engines, provider
 * plugins, effort mappings). One factory builds an AI SDK `LanguageModel` per
 * provider, configured with the user's API key and base URL. GLM and DeepSeek
 * are OpenAI-compatible, so they reuse the OpenAI provider in "compatible" chat
 * mode. Reasoning defaults to HIGH for every reasoning-capable model; effort
 * selection is gone.
 */
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import type { ProviderOptions } from "@ai-sdk/provider-utils"
import type { LanguageModel } from "ai"
import { PROVIDER } from "./config/catalog.ts"

export function createModel(
	providerId: string,
	modelId: string,
	apiKey: string,
	baseUrl: string,
): LanguageModel {
	switch (providerId) {
		case PROVIDER.anthropic:
			return createAnthropic({ apiKey, baseURL: baseUrl })(modelId)
		case PROVIDER.gemini:
			return createGoogleGenerativeAI({ apiKey, baseURL: baseUrl })(modelId)
		case PROVIDER.openai:
			return createOpenAI({ apiKey, baseURL: baseUrl })(modelId)
		case PROVIDER.glm:
		case PROVIDER.deepseek:
			// OpenAI-compatible: standard chat completions.
			return createOpenAI({ apiKey, baseURL: baseUrl, name: providerId }).chat(modelId)
		default:
			throw new Error(`Unknown provider: ${providerId}`)
	}
}

// HIGH reasoning effort, per provider. Attached to the agent only when
// `Model.reasoning === true`. Keys verified against installed @ai-sdk/* source.
export function reasoningOpts(providerId: string): ProviderOptions {
	switch (providerId) {
		case PROVIDER.anthropic:
			return { anthropic: { effort: "high" } }
		case PROVIDER.gemini:
			return { google: { thinkingConfig: { thinkingLevel: "high" } } }
		case PROVIDER.openai:
		case PROVIDER.glm:
		case PROVIDER.deepseek:
			return { openai: { reasoningEffort: "high" } }
		default:
			return {}
	}
}
