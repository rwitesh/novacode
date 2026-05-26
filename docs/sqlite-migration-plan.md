# SQLite Migration Plan — Replace JSONL Session Storage

## Goal

Replace the per-session JSONL file approach (`~/.novacode/sessions/<id>/messages.jsonl` + `metadata.json` + `history.jsonl`) with a single SQLite database (`~/.novacode/state.db`). This enables:

- Token/cost tracking per session
- Efficient listing, filtering, and querying
- Preserved history on compaction (old sessions untouched)
- Foundation for future features (cross-session search, analytics)
- Simpler backup (one file vs a directory tree)

## Design Decisions

### Session Splitting on Compaction (Hermes Pattern)

On compaction, **end the current session** and **create a new continuation session** linked via `parent_session_id`. Old session rows are never mutated. One table, one write per append.

```
session_A (100 messages, end_reason='compacted')
session_B (parent=A, summary + 20 tail messages, active)
```

**Why this is cleanest:**
- One `messages` table, one INSERT per append
- No flags to forget, no duplicated rows, no seq conflicts
- Old data is untouched rows — cleanest preservation
- `messages()` = `WHERE session_id = currentActiveId`
- Compaction = INSERT new session + INSERT new messages (no UPDATE/DELETE)

**Session list shows only active sessions:**
```sql
SELECT * FROM sessions WHERE end_reason IS NULL ORDER BY updated DESC
```

**History/display walks the parent chain:**
```sql
-- Load all messages from the lineage (root → tip)
SELECT m.* FROM messages m
JOIN sessions s ON m.session_id = s.id
WHERE s.id IN (?, ?, ?)  -- collected by walking parent chain
ORDER BY s.created ASC, m.seq ASC
```

Usually 2-3 hops max. One query after collecting the IDs.

### Compaction Algorithm

Accept that compaction invalidates prompt caching. Design for maximum compaction quality instead:

1. Summarize everything except the tail via LLM
2. Keep last 20 messages as tail
3. End current session (`end_reason = 'compacted'`)
4. Create new session with `parent_session_id = oldSessionId`
5. Insert summary message + tail messages into new session
6. Switch active session to the new one

Tail sizing: **message count with per-message content cap**
- Keep the last **20 messages** (covers 2-3 full user→assistant rounds including tool loops)
- Any single message whose content exceeds ~8000 chars (~2000 tokens) gets truncated with a `[truncated]` marker
- Message count (not token count) ensures complete, coherent exchanges — no mid-exchange cuts

### SQLite Package

Use `node:sqlite` (built into Node >= 22, stable in Node 24). No external dependencies.

> **Note**: A separate md file will be provided with `node:sqlite` usage patterns. Read that before implementing and adjust accordingly.

---

## Database Schema

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    cwd TEXT NOT NULL,
    model TEXT NOT NULL,
    provider TEXT NOT NULL,
    title TEXT,
    parent_session_id TEXT,         -- links to previous session after compaction
    end_reason TEXT,                -- 'compacted', null if active
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    role TEXT NOT NULL,             -- 'user', 'assistant', 'tool_result'
    content TEXT,                   -- serialized: plain string or JSON with sentinel prefix
    tool_call_id TEXT,
    tool_name TEXT,
    tool_args TEXT,
    model TEXT,
    provider TEXT,
    usage_input INTEGER DEFAULT 0,
    usage_output INTEGER DEFAULT 0,
    stop_reason TEXT,
    is_error INTEGER DEFAULT 0,
    ts INTEGER NOT NULL
);

-- Indexes
CREATE INDEX idx_sessions_updated ON sessions(updated DESC);
CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);
CREATE INDEX idx_messages_session ON messages(session_id, seq);
```

No FTS5, no triggers, no virtual tables. Add FTS5 when the search tool is built. Backfilling from existing data is a single `INSERT INTO ... SELECT` statement.

---

## Implementation Steps

### Step 1: Add `node:sqlite` helper module

**File**: `src/session/db.ts`

- [ ] Create `DatabaseSync` wrapper using `node:sqlite`
- [ ] Handle WAL mode setup
- [ ] Handle schema initialization (CREATE TABLE IF NOT EXISTS)
- [ ] Export a `getDb(path?: string)` singleton (lazy init)
- [ ] Read the `node:sqlite` usage md file before writing this

**Key decisions**:
- `node:sqlite` is synchronous (DatabaseSync). Fine for Novacode's single-writer CLI pattern.
- Store DB at `~/.novacode/state.db`
- On first run, create tables + indexes

### Step 2: Rewrite `SessionStore` class

**File**: `src/session/store.ts`

- [ ] Remove all `node:fs/promises` imports
- [ ] Remove all path helpers (`#sessionDir`, `#metadataPath`, `#messagesPath`, `#historyPath`)
- [ ] Replace with SQLite queries via `db.ts` helper

**Method mapping** (old JSONL → new SQLite):

| Old method | New implementation |
|---|---|
| `create(cwd, model, provider)` | `INSERT INTO sessions` |
| `get(id)` | `SELECT * FROM sessions WHERE id = ?` |
| `list(limit)` | `SELECT * FROM sessions WHERE end_reason IS NULL ORDER BY updated DESC LIMIT ?` |
| `latest()` | Same query, limit 1 |
| `delete(id)` | `DELETE FROM sessions WHERE id = ?` (cascades to messages) |
| `deleteAll()` | `DELETE FROM messages; DELETE FROM sessions` |
| `append(sessionId, msg)` | `INSERT INTO messages` + `UPDATE sessions SET message_count += 1, updated = ?` |
| `messages(sessionId)` | `SELECT * FROM messages WHERE session_id = ? ORDER BY seq` |
| `history(sessionId)` | Walk parent chain to collect lineage session IDs, then `SELECT * FROM messages WHERE session_id IN (...) ORDER BY created, seq` |
| `messageCount(sessionId)` | `SELECT message_count FROM sessions WHERE id = ?` |
| `setTitle(sessionId, title)` | `UPDATE sessions SET title = ? WHERE id = ?` |
| `replaceMessages(...)` | **Removed** — replaced by session splitting |
| `prune()` | `DELETE FROM sessions WHERE message_count = 0 AND end_reason IS NULL AND created < ?` |

**New methods**:

| Method | Purpose |
|---|---|
| `endSession(id, reason)` | `UPDATE sessions SET end_reason = ? WHERE id = ?` |
| `createContinuation(parentId, cwd, model, provider)` | `INSERT INTO sessions` with `parent_session_id = parentId`. Returns new session. |
| `getLineage(sessionId)` | Walk `parent_session_id` chain backward to root. Return array of session IDs (root first). |
| `history(sessionId)` | Uses `getLineage()` to collect all session IDs, then queries all messages across the chain. |

**Content serialization**: `Msg.content` can be `string | ContentPart[]`. Store structured content as JSON with a sentinel prefix (`\x00json:`). Plain strings stored as-is. On read, detect prefix and deserialize.

### Step 3: Update `types.ts`

**File**: `src/types.ts`

- [ ] Add `parentSessionId?: string | null` to `Session`
- [ ] Add `endReason?: string | null` to `Session`
- [ ] Add `messageCount: number` to `Session`
- [ ] Add `inputTokens: number` and `outputTokens: number` to `Session`
- [ ] Add `newSessionId?: string` to `CompactResult`

### Step 4: Rewrite compaction — session splitting

**File**: `src/session/compact.ts`

- [ ] Remove `replaceMessages` call
- [ ] New flow:
  1. Compute tail: last 20 messages. Truncate any message content > ~8000 chars.
  2. Summarize everything before the tail via LLM.
  3. `store.endSession(sessionId, "compacted")`
  4. `store.createContinuation(sessionId, cwd, model, provider)` → returns new session
  5. Insert summary message + tail messages into new session
  6. Return `CompactResult` with `newSessionId`

**Function signature:**

```typescript
export async function compact(
    store: SessionStore,
    sessionId: string,
    messages: Msg[],
    model: Model,
    apiKey: string,
    baseUrl: string,
    cwd: string,
): Promise<CompactResult>
```

`cwd` is needed to create the continuation session. `CompactResult.newSessionId` tells the caller to switch.

### Step 5: Update callers of compaction

**File**: `src/commands/compact.ts`

- [ ] After compaction, if `result.newSessionId` exists:
  - Load messages from new session
  - Update agent messages
  - Return the new session ID to the TUI

**File**: `src/tui/app.tsx`

- [ ] `handleCompact` returns `{ result, newSessionId }`
- [ ] If `newSessionId`, call `handleSwitchSession(newSessionId)` to update session state
- [ ] `handleSwitchSession` already exists and handles all the wiring (agent update, message reload, session ID state)

### Step 6: Remove JSONL-specific code

- [ ] Remove `writeToHistory` parameter from `append()`
- [ ] Remove `replaceMessages()` method
- [ ] Remove all `node:fs/promises` usage from session code
- [ ] Remove `#sessionDir()`, `#metadataPath()`, `#messagesPath()`, `#historyPath()` helpers

### Step 7: Update tests

**File**: `test/store.test.ts`

- [ ] Replace `createTempStore()` — create temp `.db` file instead of temp directory
- [ ] Remove tests for `replaceMessages` and history fallback behavior
- [ ] Add new tests:
  - `createContinuation` links parent correctly
  - `getLineage` walks chain correctly (1 hop, 2 hops, 3 hops)
  - `history()` returns messages across entire lineage
  - `list()` only shows active sessions (hides compacted parents)
  - `endSession` + `createContinuation` flow (full compaction simulation)
  - Token tracking on append
  - Content serialization round-trip (string vs ContentPart[])
  - Multiple compactions produce a 3-session chain, history loads all

### Step 8: Token tracking

- [ ] On `append()` for assistant messages, accumulate `input_tokens` and `output_tokens` on the session row
- [ ] Display token usage in `/sessions list` output
- [ ] Data flows through `AgentEvent.usage` — just persist it

---

## File Changes Summary

| File | Action |
|---|---|
| `src/session/db.ts` | **New** — SQLite connection, schema init |
| `src/session/store.ts` | **Rewrite** — JSONL → SQLite, session splitting API |
| `src/session/compact.ts` | **Rewrite** — session splitting compaction |
| `src/types.ts` | **Edit** — extend Session + CompactResult types |
| `src/commands/compact.ts` | **Edit** — handle session switch after compaction |
| `src/commands/session.ts` | **Edit** — add token display, hide compacted sessions |
| `src/tui/app.tsx` | **Edit** — switch session ID after compaction |
| `src/main.ts` | **Edit** — update store init |
| `test/store.test.ts` | **Rewrite** — SQLite-based tests |

---

## Implementation Order

Each step must compile and pass `npm run check` before the next:

1. **Step 1** — `db.ts` (foundation, no callers)
2. **Step 3** — `types.ts` (additive, no breakage)
3. **Step 2** — `store.ts` rewrite (biggest change)
4. **Step 7** — `test/store.test.ts` (verify store)
5. **Step 4** — `compact.ts` rewrite (depends on store)
6. **Step 5** — Update callers (`commands/compact.ts`, `app.tsx`)
7. **Step 6** — Remove dead JSONL code
8. **Step 8** — Token tracking (small, additive)

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `node:sqlite` API differences | Read the provided md file first |
| ContentPart[] serialization edge cases | Sentinel prefix + JSON, test round-trips |
| Single `state.db` corruption | WAL mode + checkpoint. One-file backup. |
| Sync API blocks event loop | Fine for CLI single-writer. Each query <1ms. |
| Long lineage chains | Unlikely in practice (3-4 compactions max). Walk is O(depth). |

---

## What NOT to Do

- Don't add `better-sqlite3` or any native dependency
- Don't try to preserve prompt caching across compaction
- Don't add FTS5 until the search tool is built
- Don't use an `archived` flag (mutating rows is messy, seq conflicts)
- Don't use two tables (double writes per append)
- Don't build the search tool yet — schema supports it when ready
