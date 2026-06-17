import type { Effort, ProviderStream } from "../types.ts"
import { createStream } from "./base/openai.ts"

export const glmProvider: ProviderStream = {
	id: "glm",
	efforts: { options: ["low", "medium", "high", "xhigh", "max"], default: "max" },
	stream: createStream({
		mapEffort: (e: Effort) => e,
		thinkingToggle: true,
		maxTokensField: "max_tokens",
	}),
}
