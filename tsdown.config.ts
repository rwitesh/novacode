import { defineConfig } from "tsdown"

export default defineConfig({
	entry: "src/main.ts",
	format: ["esm"],
	outDir: "dist",
	clean: true,
	minify: true,
	sourcemap: true,
	platform: "node",
})
