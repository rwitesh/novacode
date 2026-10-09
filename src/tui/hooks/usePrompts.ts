import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { PolicyEngine } from "../../policy/engine.ts"
import type { ApprovalRequest, PolicyApprover, Prompts } from "../../types.ts"
import type { PromptMode } from "../types.ts"

type PendingPrompt = { mode: PromptMode; resolve: (value: unknown) => void; id: number }

export function usePrompts(policy: PolicyEngine) {
	const [mode, setMode] = useState<PromptMode>({ type: "chat" })
	const [promptId, setPromptId] = useState(0)
	const pending = useRef<PendingPrompt[]>([])
	const nextId = useRef(0)

	const show = useCallback((prompt?: PendingPrompt) => {
		setMode(prompt?.mode ?? { type: "chat" })
		setPromptId(prompt?.id ?? 0)
	}, [])

	const request = useCallback(
		(mode: PromptMode, resolve: (value: unknown) => void) => {
			const prompt = { mode, resolve, id: ++nextId.current }
			pending.current.push(prompt)
			if (pending.current.length === 1) show(prompt)
		},
		[show],
	)

	const prompts = useMemo<Prompts>(
		() => ({
			select: (config) =>
				new Promise<string | null>((resolve) => {
					request({ type: "select", ...config }, resolve as (v: unknown) => void)
				}),
			searchSelect: (config) =>
				new Promise<string | null>((resolve) => {
					request({ type: "searchSelect", ...config }, resolve as (v: unknown) => void)
				}),
			password: (config) =>
				new Promise<string | null>((resolve) => {
					request({ type: "password", ...config }, resolve as (v: unknown) => void)
				}),
			confirm: (config) =>
				new Promise<boolean | null>((resolve) => {
					request({ type: "confirm", ...config }, resolve as (v: unknown) => void)
				}),
		}),
		[request],
	)

	const approver = useMemo<PolicyApprover>(
		() => ({
			request: (req: ApprovalRequest) =>
				new Promise<boolean>((resolve) => {
					request({ type: "approval", req }, (value) => resolve(value === true))
				}),
		}),
		[request],
	)

	const cancelPrompts = useCallback(() => {
		const canceled = pending.current.splice(0)
		show()
		for (const prompt of canceled) prompt.resolve(null)
	}, [show])

	useEffect(() => {
		policy.setApprover(approver)
		return () => {
			policy.setApprover(null)
			for (const prompt of pending.current.splice(0)) prompt.resolve(null)
		}
	}, [policy, approver])

	const resolvePrompt = (value: unknown) => {
		if (pending.current[0]?.id !== promptId) return
		const prompt = pending.current.shift()
		show(pending.current[0])
		prompt?.resolve(value)
	}

	return { mode, promptId, prompts, resolvePrompt, cancelPrompts }
}
