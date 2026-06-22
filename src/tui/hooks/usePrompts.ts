import { useEffect, useMemo, useRef, useState } from "react"
import type { PolicyEngine } from "../../policy/engine.ts"
import type { ApprovalRequest, PolicyApprover, Prompts } from "../../types.ts"
import type { PromptMode } from "../types.ts"

/**
 * Hook that manages interactive prompt screens and hooks them up to the agent policy engine.
 *
 * It acts as a bridge between the asynchronous command/policy validation loop (which expects
 * Promise-based inputs) and the React rendering tree. Calling any prompt method (like select or
 * confirm) returns a Promise, updates the React state to render the prompt overlay, and stores
 * the resolver callback in a ref to be resolved once user input is captured.
 */
export function usePrompts(policy: PolicyEngine) {
	const [mode, setMode] = useState<PromptMode>({ type: "chat" })
	// Stores the active prompt's Promise resolver.
	// Since commands run sequentially, we only ever have a single active prompt at a time.
	const resolveRef = useRef<((v: unknown) => void) | null>(null)

	const prompts = useMemo<Prompts>(
		() => ({
			select: (config) =>
				new Promise<string | null>((resolve) => {
					resolveRef.current = resolve as (v: unknown) => void
					setMode({ type: "select", ...config })
				}),
			searchSelect: (config) =>
				new Promise<string | null>((resolve) => {
					resolveRef.current = resolve as (v: unknown) => void
					setMode({ type: "searchSelect", ...config })
				}),
			password: (config) =>
				new Promise<string | null>((resolve) => {
					resolveRef.current = resolve as (v: unknown) => void
					setMode({ type: "password", ...config })
				}),
			confirm: (config) =>
				new Promise<boolean | null>((resolve) => {
					resolveRef.current = resolve as (v: unknown) => void
					setMode({ type: "confirm", ...config })
				}),
		}),
		[],
	)

	const approver = useMemo<PolicyApprover>(
		() => ({
			request: (req: ApprovalRequest) =>
				new Promise<boolean>((resolve) => {
					resolveRef.current = (v: unknown) => resolve(v === true)
					setMode({ type: "approval", req })
				}),
		}),
		[],
	)

	// Automatically registers this TUI component's modal handler with the policy engine.
	// This intercepts unsafe tool calls and shows approval prompts inline within the TUI.
	useEffect(() => {
		policy.setApprover(approver)
		return () => policy.setApprover(null)
	}, [policy, approver])

	const resolvePrompt = (value: unknown) => {
		const fn = resolveRef.current
		resolveRef.current = null
		setMode({ type: "chat" })
		fn?.(value)
	}

	return {
		mode,
		setMode,
		prompts,
		resolvePrompt,
	}
}
