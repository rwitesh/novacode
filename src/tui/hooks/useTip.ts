import { useEffect, useState } from "react"

const TIPS = [
	"Press / to open commands.",
	"Use @ to reference files.",
	"Press Esc to cancel input.",
	"Use arrow keys to navigate history.",
	"Use Tab for autocomplete.",
	"Use Shift+Tab to move backwards.",
	"Use Ctrl+C to stop execution.",
	"Press Page Up / Page Down to scroll history.",
	"Use /compact to shrink context when it gets long.",
	"Use /models to switch providers and models.",
	"Use /sessions to browse and resume past sessions.",
	"Use /skills to list auto-loaded agent skills.",
]

const ROTATE_MS = 8000

export function useTip(): string {
	const [idx, setIdx] = useState(0)

	useEffect(() => {
		const id = setInterval(() => {
			setIdx((i) => (i + 1) % TIPS.length)
		}, ROTATE_MS)
		return () => clearInterval(id)
	}, [])

	return TIPS[idx]!
}
