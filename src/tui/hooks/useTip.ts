import { useCallback, useRef, useState } from "react"

const TIPS = [
	"/compact: shrink context when it gets long",
	"/models: switch between providers and models",
	"Up/Down: scroll through your input history",
	"Tab: autocomplete slash commands",
	"Ctrl+C twice: exit novacode",
	"Ctrl+D: quick exit",
	"/clear: wipe screen and start a fresh session",
	"/sessions: browse and resume past sessions",
	"/skills: list auto-loaded agent skills",
	"/providers: manage API keys and providers",
	"/update: check and install the latest version",
	"Esc: abort the current response",
	"nova -r: resume last session from CLI",
	"AGENTS.md: project context loaded automatically",
	"/reset: wipe all nova data and start fresh",
]

export function useTip(busy: boolean): string | null {
	const [tip, setTip] = useState<string | null>(null)
	const lastBusy = useRef(false)

	const pick = useCallback(() => {
		return TIPS[Math.floor(Math.random() * TIPS.length)]!
	}, [])

	if (busy && !lastBusy.current) {
		setTip(pick())
	} else if (!busy && lastBusy.current) {
		setTip(null)
	}
	lastBusy.current = busy

	return tip
}
