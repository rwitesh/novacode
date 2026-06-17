import type { Effort, ProviderStream } from "../types.ts"
import { createStream } from "./base/openai.ts"

export const openaiProvider: ProviderStream = {
	id: "openai",
	efforts: { options: ["low", "medium", "high"], default: "high" },
	stream: createStream({
		mapEffort: (e: Effort) => (e === "low" || e === "medium" || e === "high" ? e : "high"),
		maxTokensField: "max_completion_tokens",
	}),
}
