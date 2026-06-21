import type { PromptMode } from "../types.ts"
import { ApprovalPrompt } from "./ApprovalPrompt.tsx"
import { ConfirmPrompt } from "./ConfirmPrompt.tsx"
import { PasswordPrompt } from "./PasswordPrompt.tsx"
import { SearchSelectPrompt } from "./SearchSelectPrompt.tsx"
import { SelectPrompt } from "./SelectPrompt.tsx"

export function PromptOverlay({
	mode,
	searchQuery,
	searchSelectedIdx,
	onResolve,
}: {
	mode: PromptMode
	searchQuery?: string
	searchSelectedIdx?: number
	onResolve: (value: unknown) => void
}) {
	switch (mode.type) {
		case "select":
			return (
				<SelectPrompt
					message={mode.message}
					options={mode.options}
					header={mode.header}
					footer={mode.footer}
					onSelect={onResolve}
				/>
			)
		case "searchSelect":
			return (
				<SearchSelectPrompt
					message={mode.message}
					options={mode.options}
					query={searchQuery ?? ""}
					selectedIdx={searchSelectedIdx ?? 0}
					header={mode.header}
					footer={mode.footer}
				/>
			)
		case "password":
			return <PasswordPrompt message={mode.message} validate={mode.validate} onSubmit={onResolve} />
		case "confirm":
			return <ConfirmPrompt message={mode.message} onConfirm={onResolve} />
		case "approval":
			return <ApprovalPrompt req={mode.req} onResolve={onResolve} />
		default:
			return null
	}
}
