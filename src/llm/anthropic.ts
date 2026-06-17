import type { ProviderStream } from "../types.ts"
import { createStream } from "./base/anthropic.ts"

export const anthropicProvider: ProviderStream = {
	id: "anthropic",
	efforts: { options: ["low", "medium", "high", "xhigh", "max"], default: "high" },
	stream: createStream(),
}
