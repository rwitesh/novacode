import { Box, Text, useInput } from "ink"
import { useState } from "react"
import type { ApprovalRequest } from "../../types.ts"
import { useTheme } from "../theme/index.tsx"
import { PromptFrame } from "./PromptFrame.tsx"
import { Toggle } from "./Toggle.tsx"

export function ApprovalPrompt({
	req,
	onResolve,
}: {
	req: ApprovalRequest
	onResolve: (allow: boolean | null) => void
}) {
	const theme = useTheme()
	const [allow, setAllow] = useState(true)

	useInput((_, key) => {
		if (key.escape) {
			onResolve(null)
			return
		}
		if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.tab) {
			setAllow((a) => !a)
			return
		}
		if (key.return) {
			onResolve(allow)
		}
	})

	return (
		<PromptFrame>
			{req.warning && (
				<Box marginBottom={1}>
					<Text bold color={theme.palette.warning}>
						{req.warning}
					</Text>
				</Box>
			)}
			<Box flexDirection="row" marginBottom={1}>
				<Text bold color={theme.palette.warning}>
					Approve?{" "}
				</Text>
				<Text color={theme.palette.muted}>{req.summary}</Text>
			</Box>
			<Toggle yesLabel="Allow once" noLabel="Deny" selected={allow ? "yes" : "no"} />
			<Box marginTop={1}>
				<Text color={theme.palette.muted}>←→ toggle · Enter confirm · Esc deny</Text>
			</Box>
		</PromptFrame>
	)
}
