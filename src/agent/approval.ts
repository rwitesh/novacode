/**
 * Approval gate applied to a ToolSet at wiring time.
 *
 * Keeps the PolicyEngine (the approval authority) fully separate from tool
 * definitions: tools know nothing about policy. `withApproval` wraps each
 * tool's `execute` so the engine runs first; a denial yields an error result
 * the model sees, so the loop continues in a single stream (no extra model
 * round-trip, unlike the native two-phase approval flow).
 */
import type { ToolSet } from "ai"
import { textPart } from "../content.ts"
import type { PolicyEngine } from "../policy/engine.ts"
import type { ToolResult } from "../types.ts"

export function withApproval(tools: ToolSet, policy: PolicyEngine | null): ToolSet {
	if (!policy) return tools

	const wrapped: ToolSet = {}
	for (const [name, t] of Object.entries(tools)) {
		const original = t.execute
		if (!original) {
			wrapped[name] = t
			continue
		}
		wrapped[name] = {
			...t,
			// biome-ignore lint/suspicious/noExplicitAny: tool inputs/outputs are heterogeneous across a ToolSet; a generic wrapper cannot preserve per-tool generics
			execute: async (input: any, opts: any): Promise<ToolResult> => {
				const decision = await policy.check({ name, args: input })
				if (!decision.allow) {
					return { content: [textPart(decision.reason ?? "Blocked")], isError: true }
				}
				return original(input, opts)
			},
		}
	}
	return wrapped
}
