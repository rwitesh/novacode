# Releasing Novacode

## Prerequisites

- All changes merged to `main`
- `bun run check` passes (typecheck + lint + test)

## Bump Version

```bash
bun pm version patch   # 0.1.0 → 0.1.1 (bug fixes)
bun pm version minor   # 0.1.0 → 0.2.0 (new features)
bun pm version major   # 0.1.0 → 1.0.0 (breaking changes)
```

## Publish

```bash
bun publish --access public
```

The `"files": ["src"]` field in `package.json` ensures only the `src/` directory is published.

## Push

```bash
git push && git push --tags
```