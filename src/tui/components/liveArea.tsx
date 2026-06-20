import { Text } from "ink"
import { useEffect, useState } from "react"
import { SPINNER_FRAMES } from "../constants.ts"

export function Spinner() {
	const [frame, setFrame] = useState(0)

	useEffect(() => {
		const timer = setInterval(() => {
			setFrame((f) => (f + 1) % SPINNER_FRAMES.length)
		}, 80)
		return () => clearInterval(timer)
	}, [])

	return <Text color="yellow">{SPINNER_FRAMES[frame]}</Text>
}

export function Cursor() {
	const [visible, setVisible] = useState(true)
	useEffect(() => {
		const timer = setInterval(() => setVisible((v) => !v), 530)
		return () => clearInterval(timer)
	}, [])
	return <Text color="white">{visible ? "█" : " "}</Text>
}
