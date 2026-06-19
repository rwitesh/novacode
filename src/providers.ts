import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import type { ProviderOptions } from "@ai-sdk/provider-utils"
import type { LanguageModel } from "ai"
import { PROVIDER } from "./models/catalog.ts"

const COMPATIBLE_BASE_URL: Record<string, string> = {
	[PROVIDER.glm]: "https://api.z.ai/api/coding/paas/v4",
	[PROVIDER.deepseek]: "https://api.deepseek.com",
}

export function createModel(providerId: string, modelId: string, apiKey: string): LanguageModel {
	switch (providerId) {
		case PROVIDER.anthropic:
			return createAnthropic({ apiKey })(modelId)
		case PROVIDER.gemini:
			return createGoogleGenerativeAI({ apiKey })(modelId)
		case PROVIDER.openai:
			return createOpenAI({ apiKey })(modelId)
		case PROVIDER.glm:
		case PROVIDER.deepseek:
			return createOpenAI({
				apiKey,
				baseURL: COMPATIBLE_BASE_URL[providerId],
				name: providerId,
			}).chat(modelId)
		default:
			throw new Error(`Unknown provider: ${providerId}`)
	}
}

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
