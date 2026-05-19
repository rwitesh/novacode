# 08 — Sessions

## Store (SQLite)

Uses `bun:sqlite` — zero dependencies, synchronous API, WAL mode for crash safety.

### Schema

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  title TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,           -- JSON-serialized Msg
  ts INTEGER NOT NULL
);

CREATE INDEX idx_messages_session ON messages(session_id, seq);

CREATE TABLE compactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  files_read TEXT NOT NULL DEFAULT '[]',
  files_wrote TEXT NOT NULL DEFAULT '[]',
  seq_before INTEGER NOT NULL,
  ts INTEGER NOT NULL
);
```

### API

```typescript
const store = getSessionStore() // singleton, creates ~/.novacode/sessions.db

// Lifecycle
store.create(cwd, model, provider)   // → Session
store.get(id)                        // → Session | null
store.list(limit?)                   // → Session[] (sorted by updated DESC)
store.delete(id)                     // → boolean

// Messages
store.append(sessionId, msg)         // append single Msg
store.appendMany(sessionId, msgs)    // append in a transaction
store.messages(sessionId)            // → Msg[] (all, in order)
store.messageCount(sessionId)        // → number

// Compaction
store.saveCompaction(sessionId, summary, filesRead, filesWrote, seqBefore)
store.getLatestCompaction(sessionId) // → { summary, seqBefore } | null
store.truncateBeforeSeq(sessionId, seq)

// Metadata
store.setTitle(sessionId, title)
```

### Why SQLite over JSONL

| | JSONL | SQLite |
|---|---|---|
| List/filter sessions | Parse first line of every file | Indexed `SELECT` |
| Delete session | Unlink file + error handling | `DELETE CASCADE` |
| Crash safety | Can corrupt mid-append | WAL mode = atomic |
| File management | N files for N sessions | Single `sessions.db` |
| Bun API | `Bun.file()` (async) | `bun:sqlite` (sync, 3-6x faster) |
| Query flexibility | None | SQL |

## Compaction

When the conversation approaches 80% of the context window:

1. Keep the last 10 messages intact
2. Summarize older messages via an LLM call
3. Save the compaction record to the `compactions` table
4. Delete the old messages from the `messages` table
5. Insert a synthetic user message with the summary

```typescript
import { needsCompact, compact } from "./session/compact.ts"

// Check before each turn
if (needsCompact(messages, model.contextWindow)) {
  const result = await compact(store, sessionId, messages, model, apiKey, baseUrl)
  // result.compacted, result.summary, result.msgsRemoved
}
```
