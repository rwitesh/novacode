import type { Effort, ProviderStream } from "../types.ts"
import { createStream } from "./base/openai.ts"

export const deepseekProvider: ProviderStream = {
	id: "deepseek",
	efforts: { options: ["high", "max"], default: "high" },
	stream: createStream({
		mapEffort: (e: Effort) => {
			if (e === "low" || e === "medium") return "high"
			if (e === "xhigh") return "max"
			return e
		},
		thinkingToggle: true,
		maxTokensField: "max_tokens",
	}),
}
