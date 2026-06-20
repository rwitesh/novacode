# Testing Ink Components Reference

Testing console UIs relies on virtual stream capture. Ink provides testing support via `ink-testing-library` and custom mock renderers.

---

## 1. Setup & ink-testing-library
To test, import `render` from `ink-testing-library`. It captures output in a virtual stdout stream:
```jsx
import {render} from 'ink-testing-library';
import {Text} from 'ink';

const TestComponent = () => <Text>Hello World</Text>;
const {lastFrame} = render(<TestComponent />);

console.log(lastFrame() === 'Hello World'); // true
```

---

## 2. React 19 Concurrent Mode & `act()` wrapping
In modern Ink (version 7+), concurrent rendering changes update schedules. State modifications and asynchronous rendering boundaries **MUST** be wrapped in React's `act()` function.

### Asynchronous Testing Helper Pattern
Create an asynchronous renderer wrapping the initial render and rerenders in `act()`:
```typescript
import {act} from 'react';
import {render} from 'ink';
import createStdout from './create-stdout.js'; // or virtual stream helper

export async function renderAsync(node: React.ReactNode) {
  const stdout = createStdout();
  let instance;

  await act(async () => {
    instance = render(node, {
      stdout,
      concurrent: true,
      debug: true
    });
  });

  return {
    ...instance,
    stdout,
    getOutput: () => stdout.get(),
    async rerenderAsync(newNode: React.ReactNode) {
      await act(async () => {
        instance.rerender(newNode);
      });
    }
  };
}
```

---

## 3. Simulating Keyboard & Paste Inputs
To test interactive components (e.g. text inputs, select lists), simulate keys by writing directly to a mocked stdin stream.

### Key press structure
Write ANSI escape codes to stdin to invoke `useInput` hooks:
```typescript
import {render} from 'ink-testing-library';

const {stdin, lastFrame} = render(<MyInputComponent />);

// Type letters
stdin.write('abc');

// Simulate return/enter key
stdin.write('\r');

// Simulate left arrow key
stdin.write('\u001b[D'); // Left arrow ANSI escape code
```

---

## 4. Simulating Terminal Resize
To test responsive layouts that adjust columns/rows dynamically:
1. Update `columns` and `rows` properties on the mocked `stdout` stream.
2. Emit the `'resize'` event on `stdout` to notify the `useWindowSize` hooks.

```typescript
const stdout = mockStdout();
const instance = render(<ResizableLayout />, {stdout});

// Trigger resize
stdout.columns = 120;
stdout.rows = 40;
stdout.emit('resize');
```

---

## 5. Assertions & ANSI Stripping
When matching TUI output against expected layouts, terminal escape sequences (colors, cursors, screen-clears) can pollute comparisons. Use `strip-ansi` to perform clean string comparisons.

```typescript
import stripAnsi from 'strip-ansi';

const output = lastFrame();
const cleanOutput = stripAnsi(output);

t.is(cleanOutput, 'Clean text matches expected frame layout.');
```
- For exact style verification (colors, backgrounds), preserve ANSI tags and match with escape-aware regex or snapshots.
