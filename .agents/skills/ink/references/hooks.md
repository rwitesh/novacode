# Ink Hooks & Events Reference

React Ink provides a variety of hooks to handle terminal window sizing, user key inputs, focus management, cursor layout positions, animations, and lifecycle control.

---

## 1. `useInput(inputHandler, options?)`
Listens for user keyboard input when raw mode is active.
- **`inputHandler`**: `(input: string, key: Key) => void`
  - `input`: The string character(s) pressed. If pasting multiple characters (and `usePaste` is inactive), they arrive as a single string.
  - `key` (Object): Helper flags:
    - Arrow flags: `upArrow`, `downArrow`, `leftArrow`, `rightArrow`
    - Navigation: `pageUp`, `pageDown`, `home`, `end`
    - Execution/editing: `return` (Enter), `escape`, `backspace`, `delete`, `tab`
    - Modifiers: `ctrl`, `shift`, `meta`
    - Kitty modifiers (only with kitty keyboard protocol): `super`, `hyper`, `capsLock`, `numLock`
    - eventType: `'press' | 'repeat' | 'release'` (only with kitty keyboard protocol)
- **`options`**:
  - `isActive`: `boolean` (default `true`). Set to `false` to pause input capture (essential when managing modal overlays or switching input zones).

```jsx
useInput((input, key) => {
  if (input === 'q') exit();
  if (key.upArrow) moveSelectionUp();
}, {isActive: isFocused});
```

---

## 2. `usePaste(handler, options?)`
Captures bracketed terminal paste events (`\x1b[?2004h`).
- Prevents pasted texts with newlines from being interpreted as individual return/enter key presses in `useInput`.
- **`handler`**: `(text: string) => void` (called with the raw pasted text string).
- **`options`**:
  - `isActive`: `boolean` (default `true`).

---

## 3. `useApp()`
Exposes app lifecycle controls:
- **`exit(errorOrResult?)`**: Unmounts the tree and finishes the process.
  - Resolves `waitUntilExit()` with the value if provided, or rejects if an `Error` is passed.
- **`waitUntilRenderFlush()`**: Returns a promise that resolves once pending commits are written to the terminal stream.
- **`suspendTerminal(callback?)`**: Suspends Ink's rendering/input tracking, letting you run interactive child processes (e.g. `$EDITOR`, `fzf`, `less`).
  - *Callback mode*:
    ```js
    await suspendTerminal(async () => {
      await runChildEditor();
    });
    ```
  - *Manual mode (resumable)*:
    ```js
    const suspension = await suspendTerminal();
    try {
      await runChildEditor();
    } finally {
      await suspension.resume();
    }
    ```

---

## 4. `useStdin()`, `useStdout()`, `useStderr()`
Retrieve raw terminal streams and specialized utility wrappers:
- **`useStdin()`**:
  - `stdin`: Stdin readable stream (`process.stdin`).
  - `isRawModeSupported`: `boolean` (checks if terminal environment supports raw mode).
  - `setRawMode(enabled: boolean)`: Toggles raw mode safely.
- **`useStdout()`** & **`useStderr()`**:
  - `stdout` / `stderr`: Stream instances.
  - `write(data: string)`: Intercept-safe direct print. Prevents corruption of the active Ink layout.

---

## 5. `useBoxMetrics(ref)`
Returns the calculated layout dimensions and coordinates of a `<Box>` node, updating dynamically on resize or reflows.
- `ref`: `React.RefObject<DOMElement | null>`
- Returns: `{width: number, height: number, left: number, top: number, hasMeasured: boolean}`
- Note: Coordinates/dimensions return `0` until layout is measured and when the ref is detached.

---

## 6. `useWindowSize()`
Listens to stdout resizing and triggers a re-render with updated dimensions.
- Returns: `{columns: number, rows: number}`

---

## 7. `useFocus(options?)` & `useFocusManager()`
Manages keyboard navigation/tab-cycling order.
- **`useFocus(options)`**: Marks component as focusable.
  - `options.autoFocus`: `boolean` (take focus if none active).
  - `options.isActive`: `boolean` (temporarily toggle focusability).
  - `options.id`: `string` (identifier for direct focus selection).
  - Returns: `{isFocused: boolean}`
- **`useFocusManager()`**:
  - `enableFocus()` / `disableFocus()`: Control focus engine status.
  - `focusNext()`: Focus next element (called on Tab key).
  - `focusPrevious()`: Focus previous element (called on Shift+Tab).
  - `focus(id: string)`: Programmatic focus change.
  - `activeId`: `string | undefined` (ID of currently focused component).

---

## 8. `useCursor()`
Manages the console cursor location. Crucial for IME input overlay coordinates.
- **`setCursorPosition(pos)`**: Positions cursor at `{x: number, y: number}` relative to the Ink output wrapper. Pass `undefined` to hide the cursor.
- Note: Calculate `x` utilizing `string-width` for wide unicode/emoji sequences.

---

## 9. `useIsScreenReaderEnabled()`
- Returns `true` if screen reader support is active (enabled via `isScreenReaderEnabled: true` in `render()` options or `INK_SCREEN_READER=true` env).

---

## 10. `useAnimation(options?)`
Drives frame counters and elapsed timing ticks consolidated on a shared timer.
- **`options`**:
  - `interval`: Milliseconds between updates (default `100`).
  - `isActive`: `boolean` to play/pause (default `true`).
- **Returns**: `{frame: number, time: number, delta: number, reset: () => void}`
