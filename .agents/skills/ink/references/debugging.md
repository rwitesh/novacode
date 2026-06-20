# Debugging, node_modules, & External References

When building terminal interfaces using React Ink, issues can arise from styling configurations, event handling, or version mismatches. Follow this guide to debug and utilize official resources.

---

## 1. Inspecting Local node_modules
If TypeScript compiler errors occur or component properties behave unexpectedly, inspecting the installed source code directly in your local project workspace is often faster than searching online.

### Where to look in node_modules:
- **API & Components**: Look at `node_modules/ink/build/index.d.ts` (or the `src` folders if available). This lists all exported components, props, option parameters, and TypeScript types.
- **Styling properties**: Inspect `node_modules/ink/build/styles.js` (or similar output files) to see how layout properties map to the underlying Yoga Flexbox parameters.
- **Hook signatures**: Check the source files under `node_modules/ink/build/hooks/` to inspect hook outputs (e.g. `useInput`, `useFocus`, `usePaste`).
- **React & Renderers**: If React-specific warnings occur, review `node_modules/@types/react` type declarations and the reconciler bindings in `node_modules/react-reconciler`.

---

## 2. Online Documentation & Sources
Always refer to official sources when designing complex command-line interfaces:

- **Ink Main Repository**: [Vadim Demedes' Ink on GitHub](https://github.com/vadimdemedes/ink)
- **Ink Readme (API & Recipes)**: [GitHub Ink Readme Page](https://github.com/vadimdemedes/ink/blob/master/readme.md)
- **Yoga Flexbox Engine**: [Yoga Layout Documentation](https://yoga-layout.com/)
- **Chalk Colors**: [Chalk on GitHub](https://github.com/chalk/chalk) (Ink uses Chalk underneath for styling)
- **CLI Boxes**: [cli-boxes styles](https://github.com/sindresorhus/cli-boxes) (reference for available border types)

---

## 3. General Project Debugging Workflow
If an Ink layout is misbehaving or text is truncating in your CLI app:

1. **Verify Terminal Interaction**: Ensure that your standard stream (`process.stdout`) is interactive and `isTTY` is true. Ink disables features like synchronized output and alternate screens when interactive mode is false (e.g. inside CI pipelines).
2. **Type Check Project**: Run `npx tsc --noEmit` in your project to ensure all `<Box>` and `<Text>` components receive the correct layout attributes (Yoga Flexbox behaves strictly regarding types).
3. **Wrap async calls**: If your CLI triggers asynchronous actions (like file changes, API requests, or state increments), make sure updates are processed within React state cycles so that Ink flushes the renders.
4. **Devtools inspection**: Set `DEV=true` and start React Devtools (`npx react-devtools`) to inspect the component tree in real-time.
