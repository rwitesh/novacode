import type { Model, ProviderDef } from "../types.ts"
import { PROVIDERS } from "./catalog.ts"

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
