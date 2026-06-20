---
name: ink
description: Guidelines, best practices, layout mechanics, input handling, and testing strategies for React Ink command-line interface (CLI) applications. Use this skill when writing, modifying, or testing console interfaces using Ink in external projects.
---

# React Ink (CLI UI Engine) Integration Skill

This skill guides the agent in building, testing, and debugging command-line interfaces (CLIs) in external projects using React Ink. It covers layout styling, custom hooks, terminal event handling, and layout assertions.

## 1. Surfaces Sitemap (Offline Subdocs)

To maintain context limits, detailed guidelines are organized into topic-specific subdocs. You **MUST** read the corresponding subdocumentation when performing tasks in these areas:

- **Components & Layout**: [references/components.md](references/components.md)
  - Covers `<Box>`, `<Text>`, `<Newline>`, `<Spacer>`, `<Static>`, `<Transform>` layout mechanics, Flexbox properties in TUI, border style configuration, background coloring, etc.
- **Hooks & Events**: [references/hooks.md](references/hooks.md)
  - Covers `useInput`, `usePaste`, `useApp`, `useStdin`, `useStdout`, `useStderr`, `useBoxMetrics`, `useWindowSize`, `useFocus`, `useFocusManager`, `useCursor`, `useIsScreenReaderEnabled`, `useAnimation`.
- **Testing & Mocking**: [references/testing.md](references/testing.md)
  - Covers `ink-testing-library`, testing async concurrent components, simulating stdin keypresses, checking stdout frames, and layout assertion methods.
- **Debugging & References**: [references/debugging.md](references/debugging.md)
  - Guides on troubleshooting TUI issues, exploring definitions in local `node_modules` (e.g. `ink`, `yoga-layout`), and links to official documentation sources.

---

## 2. Core Concepts & App Lifecycle

### Flexbox Layouts in Terminal
Ink uses **Yoga**, a Flexbox layout engine. Every element is a Flexbox container.
- Think of it as if every `<div>` in the browser had `display: flex`.
- Unlike the web, all text nodes **MUST** be explicitly wrapped in a `<Text>` component.

### App Lifecycle & TTY Processes
An Ink app is a Node.js process. It stays alive only while there is active work in the Node.js event loop.
- **Immediate Exit**: If the tree contains only static elements and no timers, input listeners, or pending promises, the app renders once and exits immediately.
- **Exiting**:
  1. Pressing `Ctrl+C` (default behavior via `exitOnCtrlC: true` option in `render`).
  2. Calling `exit()` from the `useApp()` hook.
  3. Calling `unmount()` on the object returned by `render()`.
- **Awaiting Exit**: Use `waitUntilExit()` on the rendered instance to perform post-exit cleanup:
  ```jsx
  const {waitUntilExit} = render(<MyApp />);
  await waitUntilExit();
  console.log('App exited successfully.');
  ```

---

## 3. General Best Practices

1. **Aesthetics & UX**: Leverage colors (Hex, RGB, ANSI via Chalk), borders (`single`, `double`, `round`), and spacing to build interfaces that feel premium. Avoid raw text dumps without hierarchy.
2. **Interactive Elements**: When building inputs or list pickers, track which component is focused (`useFocus`) and provide clear visual cues (e.g. changing text color or border style of the active component).
3. **Screen Reader Accessibility**: Use `useIsScreenReaderEnabled` and ARIA attributes (e.g. `aria-role="checkbox"`, `aria-state={{checked: true}}`, `aria-label`) on elements to ensure screen reader users get descriptive output.
4. **Performance**: Avoid continuous rendering cycles. Use `useAnimation` to drive animation updates under a consolidated single timer, and set low frame rates for high-CPU spinners.
