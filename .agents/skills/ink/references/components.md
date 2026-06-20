# Ink Components & Layout Reference

Ink utilizes Flexbox layouts in the terminal via Facebook's **Yoga** engine.

---

## 1. `<Box>` Layout Component
`<Box>` is the fundamental layout building block in Ink, behaving like a `display: flex` container.

### Dimensions
- `width` / `height`: `number` (character cells/rows) or `string` (percentage of parent e.g., `"50%"`).
- `minWidth` / `minHeight` / `maxWidth` / `maxHeight`: Lower/upper constraints. Note: Percentages on `minWidth` and `maxWidth` are not supported.
- `aspectRatio`: Ratio of width/height. Use with at least one dimension constraint.

### Spacing & Gap
- **Padding**: `paddingTop`, `paddingBottom`, `paddingLeft`, `paddingRight`, `paddingX`, `paddingY`, `padding`.
- **Margin**: `marginTop`, `marginBottom`, `marginLeft`, `marginRight`, `marginX`, `marginY`, `margin`.
- **Gap**: `gap`, `columnGap`, `rowGap` (spaces/lines between flex children).

### Flex Alignment
- `flexGrow` (`number`): Growth ratio.
- `flexShrink` (`number`): Shrinkage ratio (default is `1`).
- `flexBasis` (`number` or `string` e.g., `"50%"`): Initial size.
- `flexDirection`: `"row"` (default), `"row-reverse"`, `"column"`, `"column-reverse"`.
- `flexWrap`: `"nowrap"`, `"wrap"`, `"wrap-reverse"`.
- `alignItems`: `"flex-start"`, `"center"`, `"flex-end"`, `"stretch"`, `"baseline"`.
- `alignSelf`: `"auto"`, `"flex-start"`, `"center"`, `"flex-end"`, `"stretch"`, `"baseline"`.
- `alignContent`: `"flex-start"` (default, unlike CSS stretch to prevent unexpected gaps), `"flex-end"`, `"center"`, `"stretch"`, `"space-between"`, `"space-around"`, `"space-evenly"`.
- `justifyContent`: `"flex-start"`, `"center"`, `"flex-end"`, `"space-between"`, `"space-around"`, `"space-evenly"`.

### Position & Visibility
- `position`: `"relative"` (default), `"absolute"`, `"static"`.
- `top`, `right`, `bottom`, `left`: Offsets for absolute/relative boxes.
- `display`: `"flex"` or `"none"` (to hide elements completely).
- `overflowX` / `overflowY` / `overflow`: `"visible"` (default) or `"hidden"`.

### Borders
- `borderStyle`: `"single"`, `"double"`, `"round"`, `"bold"`, `"singleDouble"`, `"doubleSingle"`, `"classic"`, or custom `BoxStyle` object:
  ```json
  {
    "topLeft": "↘", "top": "↓", "topRight": "↙",
    "left": "→", "right": "←",
    "bottomLeft": "↗", "bottom": "↑", "bottomRight": "↖"
  }
  ```
- `borderColor` / `borderTopColor` / `borderRightColor` / `borderBottomColor` / `borderLeftColor`: Border color names (e.g. `"green"`, `"red"`), hex codes, or RGB strings.
- `borderDimColor` / `borderTopDimColor` etc.: `boolean` to dim the border.
- `borderBackgroundColor` / `borderTopBackgroundColor` etc.: Border background coloring.
- `borderTop` / `borderRight` / `borderBottom` / `borderLeft`: `boolean` (default `true`) to toggle specific borders.

### Background
- `backgroundColor`: Fills the box area. Inherited by text nodes unless overridden.

---

## 2. `<Text>` Component
All text must reside in `<Text>`. Nested `<Text>` is allowed, but `<Box>` cannot be placed inside `<Text>`.

- `color`: Font color. Supports Chalk names (e.g. `"green"`), hex strings (`"#ffffff"`), or RGB (`"rgb(0,0,0)"`).
- `backgroundColor`: Text highlight color.
- `dimColor`: `boolean` (dim brightness).
- `bold` / `italic` / `underline` / `strikethrough` / `inverse`: Basic styles (`boolean`).
- `wrap`: `"wrap"` (line breaks on word boundary), `"hard"` (breaks words), `"truncate"` / `"truncate-end"` (ends with `…`), `"truncate-middle"` (truncates middle `He…ld`), `"truncate-start"` (truncates start `…World`).

---

## 3. `<Newline>` Component
Inserts one or more literal newline (`\n`) characters. Must be inside a `<Text>` wrapper.
- Prop: `count` (number, default `1`).
```jsx
<Text>
  Line One
  <Newline count={2} />
  Line Three
</Text>
```

---

## 4. `<Spacer>` Component
Expands along the container's main axis, pushing adjacent components apart. Shortcut for dynamic layout offsets.
- Row container: pushes elements left/right.
- Column container: pushes elements top/bottom.

---

## 5. `<Static>` Component
Optimized for log output and activity feeds that never change after initial render.
- Renders its items permanently above the rest of the dynamic layout.
- When `items` state grows, `<Static>` only renders the new items, ignoring changes to previously rendered items.
- Prop: `items` (Array).
- Prop: `children` (function: `(item, index) => ReactNode`). Requires a `key` on the root component.
- Prop: `style` (Style object for the wrapper box).

```jsx
<Static items={logs}>
  {(log, index) => (
    <Box key={log.id}>
      <Text color="gray">[{index}] {log.message}</Text>
    </Box>
  )}
</Static>
```

---

## 6. `<Transform>` Component
Applies transformations to the string output of child `<Text>` nodes before flushing to the stream.
- Prop: `transform` (function: `(lineText, lineIndex) => string`).
- Useful for text filters (e.g. uppercase, color gradients).
- Note: String inputs contain ANSI escape codes if styles were applied to children. Manipulation must be ANSI-aware (e.g., via `strip-ansi` or `slice-ansi`).
