import { render } from "ink"
import { defaultTheme, ThemeProvider } from "../theme/index.tsx"
import { PasswordPrompt } from "./PasswordPrompt.tsx"
import { SelectPrompt } from "./SelectPrompt.tsx"

interface SelectOption {
	value: string
	label: string
	hint?: string
}

export function standaloneSelect(
	message: string,
	options: SelectOption[],
	header?: string,
	footer?: string,
): Promise<string | null> {
	return new Promise((resolve) => {
		const { unmount } = render(
			<ThemeProvider theme={defaultTheme}>
				<SelectPrompt
					message={message}
					options={options}
					header={header}
					footer={footer}
					onSelect={(v) => {
						unmount()
						resolve(v)
					}}
				/>
			</ThemeProvider>,
		)
	})
}

export function standalonePassword(
	message: string,
	validate?: (v: string) => string | undefined,
): Promise<string | null> {
	return new Promise((resolve) => {
		const { unmount } = render(
			<ThemeProvider theme={defaultTheme}>
				<PasswordPrompt
					message={message}
					validate={validate}
					onSubmit={(v) => {
						unmount()
						resolve(v)
					}}
				/>
			</ThemeProvider>,
		)
	})
}
