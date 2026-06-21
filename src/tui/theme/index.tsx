import type { ReactNode } from "react"
import { createContext, useContext } from "react"
import { defaultTheme } from "./default.ts"
import type { Theme } from "./types.ts"

export { defaultTheme } from "./default.ts"
export type { Theme } from "./types.ts"

const ThemeContext = createContext<Theme>(defaultTheme)

export function ThemeProvider({
	children,
	theme = defaultTheme,
}: {
	children: ReactNode
	theme?: Theme
}) {
	return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
	return useContext(ThemeContext)
}
