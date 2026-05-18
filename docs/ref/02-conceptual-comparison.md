# 02 — Conceptual Comparison of the Three Agents

## Are They Fundamentally Different?

**No.** At the conceptual level, all three coding agents share the same core architecture. They all implement a **ReAct loop** (Reason + Act) with tools, session management, and a terminal UI. The differences are in **implementation quality, scope, and design philosophy**.

---

## Detailed Comparison

### 1. Architecture Philosophy

| | Pi | Mastra (Mastracode) | Claude Code |
|---|---|---|---|
| **Philosophy** | "Do one thing well" — minimal, modular coding agent | "Full AI framework" — agents, workflows, memory, deployers | "Polished product" — closed, opinionated, best-in-class UX |
| **Scope** | 5 focused packages | 30+ packages in monorepo | Single binary |
| **Coupling** | Low — packages can be used independently | High — deeply integrated framework | N/A (closed) |
| **Target** | Developers who want to build/extend a coding agent | Developers building AI apps + coding agent | End users who want a coding assistant |

**Winner for our use case**: **Pi** — Its modular design means we can learn from each layer independently. But Mastra's framework features (memory, observability) are worth studying.

### 2. Agent Loop Implementation

| Aspect | Pi | Mastra | Claude Code |
|--------|-----|--------|-------------|
| **Loop type** | Custom `agent-loop.ts` | Vercel AI SDK `streamText` loop | Proprietary |
| **Event system** | Rich typed events (11 event types) | Observable streams | Internal |
| **Tool execution** | Parallel + sequential (per-tool config) | Parallel with maxSteps | Internal |
| **Streaming** | Custom `EventStream` class with backpressure | AI SDK streaming | Internal |
| **Retry/recovery** | Via provider layer + hooks | AI SDK built-in | Internal |
| **Steering** | Built-in steering & follow-up queues | N/A | N/A |
| **before/after hooks** | Per-tool-call hooks | Processors pipeline | Hooks system |

**Winner**: **Pi** — The steering queue pattern (inject user messages mid-run) and per-tool execution mode are unique and powerful. The event system is the most complete.

**Mastra's advantage**: Uses Vercel AI SDK for the loop, which means less custom code but less control.

### 3. Provider / Multi-LLM System

| Aspect | Pi | Mastra | Claude Code |
|--------|-----|--------|-------------|
| **Providers** | 30+ (Anthropic, OpenAI, Google, Bedrock, Mistral, Cloudflare, etc.) | 3-4 main (via AI SDK) | 1 (Anthropic) |
| **API types** | 9 distinct APIs (anthropic-messages, openai-completions, openai-responses, etc.) | AI SDK unified | N/A |
| **Registration** | `registerApiProvider()` pattern — lazy loaded | `GatewayRegistry` + `PROVIDER_REGISTRY` | N/A |
| **Model definition** | Rich `Model<TApi>` with costs, context windows, thinking levels | `MastraModelConfig` with provider options | N/A |
| **Compatibility** | Per-provider compat flags (OpenAI-compat, Anthropic-compat) | Provider-agnostic via AI SDK | N/A |
| **Adding new provider** | Implement `StreamFunction` for the API type, register it | Add provider config to AI SDK | N/A |

**Winner**: **Pi** — Hands down the most mature multi-provider system. The API registry pattern with lazy loading is elegant and extensible.

**Key insight for our agent**: We should use Pi's `ApiProvider` pattern. To add GLM support:
1. Determine which API GLM is compatible with (likely `openai-completions` since GLM uses OpenAI-compatible APIs)
2. Either reuse the existing OpenAI completions provider with GLM's base URL
3. Or create a dedicated provider if GLM has unique API features

### 4. Tool System

| Aspect | Pi | Mastra | Claude Code |
|--------|-----|--------|-------------|
| **Core tools** | 7 (read, write, edit, bash, grep, find, ls) | Dynamic via `createTool` | Built-in + MCP tools |
| **Schema** | TypeBox (JSON Schema) | Zod | JSON Schema |
| **Validation** | Built-in via TypeBox | Zod validation | Internal |
| **File mutation safety** | `FileMutationQueue` prevents concurrent writes | N/A | Internal |
| **Tool snippets** | Included in system prompt | Via tool descriptions | Internal |
| **Custom tools** | Via extensions | Via `createTool` + MCP | Via plugins + MCP |

**Winner**: **Pi** for core tools (file mutation queue is essential), **Mastra** for extensibility (dynamic tools via `createTool`).

### 5. Session & Context Management

| Aspect | Pi | Mastra | Claude Code |
|--------|-----|--------|-------------|
| **Storage format** | JSONL (one file per session) | Database (DuckDB + configurable) | Internal |
| **Session switching** | Yes — session picker with branching | Thread-based (memory system) | Yes |
| **Compaction** | Summary-based (LLM summarizes old messages) | Memory system (working + long-term) | Internal |
| **Branch summaries** | Tracks file operations across compaction | N/A | N/A |
| **Context estimation** | Token counting for context window | Token-based via AI SDK | Internal |
| **Auto-compaction** | Yes — triggers when approaching context limit | Memory management | Internal |

**Winner**: **Pi** for simplicity (JSONL is debuggable), **Mastra** for richness (memory system with vector search).

**For our agent**: Start with JSONL (like Pi). It's simple, debuggable, and sufficient. Add database-backed storage later.

### 6. Extension / Plugin System

| Aspect | Pi | Mastra | Claude Code |
|--------|-----|--------|-------------|
| **Extensions** | Custom extension API with lifecycle | Processors pipeline | Plugins (commands, agents, skills, hooks) |
| **Custom tools** | Extensions can add tools | Yes (`createTool`, MCP) | Yes (MCP, plugins) |
| **Hook system** | `beforeToolCall` / `afterToolCall` | Input/output processors | Pre/post tool hooks |
| **Skills** | Markdown files loaded as specialized prompts | Workspace skills | Plugin skills |
| **Slash commands** | Yes | Commands | Yes (via plugins) |
| **MCP support** | Via extensions | Built-in MCP manager | Built-in |

**Winner**: **Claude Code** for user-facing ergonomics (plugins are easy to write and distribute), **Mastra** for developer-facing power (processor pipeline is very flexible).

### 7. TUI / CLI

| Aspect | Pi | Mastra | Claude Code |
|--------|-----|--------|-------------|
| **Framework** | Custom ink-like TUI (`@earendil-works/pi-tui`) | Custom TUI | Custom TUI |
| **Input modes** | Interactive, print, RPC | Interactive, headless | Interactive |
| **Model switching** | Runtime model selector | Runtime | N/A (single provider) |
| **Themes** | Yes (file-based themes) | Yes | Yes |
| **Keybindings** | Configurable | Configurable | Configurable |
| **Image support** | Yes (terminal image rendering) | N/A | Yes |
| **Diff display** | Yes (inline diffs) | N/A | Yes |

**Winner**: **Pi** — The most feature-complete TUI with RPC mode for programmatic access.

### 8. Authentication & API Keys

| Aspect | Pi | Mastra | Claude Code |
|--------|-----|--------|-------------|
| **API key storage** | Secure storage per provider | AuthStorage per provider | Anthropic auth |
| **OAuth** | GitHub Copilot OAuth, Anthropic OAuth | GitHub Copilot, OpenAI Codex OAuth | Anthropic OAuth |
| **Dynamic key resolution** | `getApiKey()` called before each LLM request | Via provider config | N/A |
| **Multiple keys** | Yes (per-provider) | Yes | N/A |

**Winner**: **Pi** — Dynamic key resolution is critical for OAuth tokens that expire during long sessions.

---

## Efficiency Analysis

### Which is Most Efficient?

**In terms of code efficiency (doing more with less):**

1. **Pi** — The agent loop is ~300 lines of clean TypeScript. The provider layer uses lazy loading and a registry pattern. The tool system is straightforward. Total: ~5 packages, clear boundaries.

2. **Mastra** — Vastly more code because it's a full framework. The coding agent part (mastracode) leverages the framework, but the framework itself is heavy. The `Agent` class alone is 7000+ lines.

3. **Claude Code** — Can't evaluate source code, but the plugin system suggests significant complexity behind the scenes.

**In terms of runtime efficiency:**

1. **Pi** — Lazy-loaded providers, streaming everywhere, minimal startup overhead.
2. **Mastra** — DuckDB for storage, observability overhead, framework initialization.
3. **Claude Code** — Polished but single-provider.

### What to Take from Each

| Take This | From | Because |
|-----------|------|---------|
| Provider registry pattern | **Pi** | Cleanest multi-provider abstraction |
| Agent loop with event system | **Pi** | Most complete lifecycle events |
| Tool definition schema (TypeBox) | **Pi** | Type-safe with JSON Schema validation |
| Steering & follow-up queues | **Pi** | Unique feature for mid-run user injection |
| Session management (JSONL) | **Pi** | Simple, debuggable, works well |
| Processor pipeline | **Mastra** | Input/output/error processing is powerful |
| Memory system concepts | **Mastra** | Working memory + long-term memory pattern |
| Plugin structure (commands, agents, skills) | **Claude Code** | User-facing ergonomics are excellent |
| Hook system (PreToolUse, PostToolUse) | **Claude Code** | Safety and customization hooks |
| Marketplace concept | **Claude Code** | Plugin distribution model |

### What NOT to Take

| Skip This | From | Because |
|-----------|------|---------|
| Full Mastra framework | **Mastra** | Too heavy for a focused coding agent |
| Mastra's Agent class (7000+ lines) | **Mastra** | Over-engineered for our needs |
| Claude Code's single-provider lock-in | **Claude Code** | We want multi-provider |
| Mastra's DuckDB dependency | **Mastra** | Overkill; start with JSONL |
| Claude Code's proprietary installer | **Claude Code** | We're OSS |

---

## The Fundamental Conceptual Difference

Despite implementation differences, there is **one fundamental conceptual difference**:

### Pi and Mastra: "Agent as a Framework"
Both treat the agent as a programmable component. You create an agent, give it tools, configure it, and run it. The agent is something you **build with**.

### Claude Code: "Agent as a Product"
Claude Code treats the agent as a finished product. You install it and use it. The plugin system lets you extend it, but the core is not designed to be embedded or customized at the framework level.

### Our Approach: "Agent as a Framework AND a Product"

We should build it as a framework first (like Pi), then layer a polished CLI product on top. The framework approach means:
- Others can build on top of our agent core
- The multi-provider system is a library, not coupled to the CLI
- The agent loop can be used programmatically (like Pi's SDK mode)

But the default experience should be polished (like Claude Code):
- `npx our-agent` just works
- Configuration is simple
- Adding a new provider is a config change, not code
