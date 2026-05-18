# 01 — How Coding Agents Work

## The Fundamental Architecture

Every coding agent, regardless of implementation, shares the same conceptual architecture. Understanding this is the foundation for building your own.

## 1. The Core Components

```
┌──────────────────────────────────────────────────────┐
│                    CODING AGENT                       │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │   CLI /   │  │   TUI    │  │   RPC / SDK      │   │
│  │  Entry    │  │  Layer   │  │   Interface      │   │
│  └────┬─────┘  └────┬─────┘  └───────┬──────────┘   │
│       │              │                │               │
│       └──────────────┼────────────────┘               │
│                      ▼                                │
│  ┌───────────────────────────────────────────────┐    │
│  │           Session Manager                      │    │
│  │  - Manages conversation history                │    │
│  │  - Handles session persistence (save/load)     │    │
│  │  - Tracks context window usage                 │    │
│  │  - Compaction (summarize old messages)         │    │
│  └───────────────────┬───────────────────────────┘    │
│                      │                                │
│                      ▼                                │
│  ┌───────────────────────────────────────────────┐    │
│  │           Agent / Agent Loop                   │    │
│  │  - The core ReAct loop                        │    │
│  │  - Manages streaming from LLM                  │    │
│  │  - Executes tool calls                         │    │
│  │  - Handles retries, errors, aborts             │    │
│  │  - Steering & follow-up message queues         │    │
│  └───────────────────┬───────────────────────────┘    │
│                      │                                │
│         ┌────────────┼─────────────┐                  │
│         ▼            ▼             ▼                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐          │
│  │  System   │ │   Tool   │ │   Provider   │          │
│  │  Prompt   │ │  System  │ │   Layer      │          │
│  │  Builder  │ │          │ │              │          │
│  └──────────┘ └──────────┘ └──────────────┘          │
│                                                      │
└──────────────────────────────────────────────────────┘
```

## 2. The Agent Loop (The Heart)

The agent loop is where everything happens. Here's how it works in detail:

### Pi's Agent Loop (Most Clean)

```
agentLoop(prompts, context, config):
  1. Add user messages to context
  2. Emit "agent_start" event
  3. Enter main loop:
     a. Call streamAssistantResponse():
        - Transform context (AgentMessage[] → AgentMessage[])  [context compaction, pruning]
        - Convert to LLM format (AgentMessage[] → Message[])   [strip UI-only messages]
        - Call provider stream function (model, context, options)
        - Stream back: text deltas, thinking deltas, tool call deltas
        - Emit "message_start", "message_update", "message_end" events
     b. Check for tool calls in assistant response
     c. If tool calls exist:
        - Prepare each tool call (validate args, run beforeToolCall hook)
        - Execute tools (parallel or sequential)
        - Run afterToolCall hooks
        - Create ToolResultMessage for each result
        - Add tool results to context
        - Loop back to (a)
     d. If no tool calls:
        - Check steering queue (messages injected mid-run)
        - Check follow-up queue (messages after agent would stop)
        - If queues empty → emit "agent_end", exit
        - If queues have messages → loop back to (a)
```

### What Makes This Work

1. **Event-driven**: The loop emits events (`agent_start`, `turn_start`, `message_start`, `message_update`, `message_end`, `tool_execution_start`, `tool_execution_end`, `turn_end`, `agent_end`). The TUI subscribes to these events to render output.

2. **Streaming-first**: LLM responses are streamed token-by-token, not waited for completely. This means the user sees output immediately.

3. **Tool execution is pluggable**: Before executing a tool, `beforeToolCall` can block it. After executing, `afterToolCall` can modify the result. This is how safety hooks work.

4. **Context transformation**: Before each LLM call, the full message history can be transformed (compacted, pruned, augmented).

5. **Abort support**: Every operation accepts an `AbortSignal` so the user can cancel at any time.

## 3. The Provider Layer

The provider layer is what makes multi-provider support possible. Here's Pi's design:

```
┌─────────────────────────────────────────────────────┐
│                  streamSimple()                      │
│         (unified entry point)                        │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│              API Registry                            │
│  Map<ApiName, ApiProvider>                           │
│                                                      │
│  "anthropic-messages"  → AnthropicProvider           │
│  "openai-completions"  → OpenAICompletionsProvider   │
│  "openai-responses"    → OpenAIResponsesProvider     │
│  "google-generative-ai" → GoogleProvider             │
│  "bedrock-converse-stream" → BedrockProvider         │
│  ...                                                 │
└──────────────────────┬──────────────────────────────┘
                       │
         Looks up provider by model.api
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│          Provider-specific stream function           │
│                                                      │
│  Each provider:                                      │
│  1. Takes Model + Context + Options                  │
│  2. Formats request for that provider's API          │
│  3. Makes HTTP request (streaming)                   │
│  4. Parses streaming response into                   │
│     AssistantMessageEventStream                      │
│  5. Returns unified AssistantMessage                 │
└─────────────────────────────────────────────────────┘
```

### Key Design: The Model Type

```typescript
interface Model<TApi> {
  id: string;           // "claude-sonnet-4-20250514"
  name: string;         // "Claude Sonnet 4"
  api: TApi;            // "anthropic-messages" | "openai-completions" | etc.
  provider: string;     // "anthropic" | "openai" | etc.
  baseUrl: string;      // API endpoint URL
  reasoning: boolean;   // supports thinking/reasoning?
  input: ("text"|"image")[];
  cost: { input, output, cacheRead, cacheWrite };  // per-million-token cost
  contextWindow: number;
  maxTokens: number;
}
```

The `api` field determines which provider handles the request. The `provider` field is just a label. This separation means:
- Same provider (e.g., "openai-completions" API) can serve multiple providers (OpenAI, DeepSeek, Groq, etc.)
- Adding a new provider just means adding the right `baseUrl` and API key

### Lazy Loading

Pi lazily loads provider modules:
```typescript
// Only imported when first used, not at startup
const anthropicProviderModulePromise = import("./anthropic.js")
```

This keeps startup fast and avoids loading unused SDKs.

## 4. The Tool System

### Core Tools Every Coding Agent Needs

| Tool | Purpose | Why It's Essential |
|------|---------|-------------------|
| **read** | Read file contents | Agent needs to understand code |
| **write** | Write/create files | Agent creates new files |
| **edit** | Make precise edits to existing files | Agent modifies existing code |
| **bash** | Execute shell commands | Agent runs tests, installs packages, etc. |
| **grep** | Search file contents | Agent searches codebase |
| **find** | Find files by name/pattern | Agent discovers project structure |
| **ls** | List directory contents | Agent explores directories |

### Tool Definition Pattern (from Pi)

```typescript
interface AgentTool<TParameters, TDetails> {
  name: string;           // "read", "bash", etc.
  description: string;    // Told to the LLM when to use this tool
  label: string;          // Human-readable label for UI
  parameters: TSchema;    // JSON Schema for parameters (TypeBox)
  execute: (toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult>;
  prepareArguments?: (args) => args;  // Pre-validation transform
  executionMode?: "sequential" | "parallel";
}

interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];  // What goes back to the LLM
  details: T;                                // Extra data for UI/logs
  terminate?: boolean;                       // Should agent stop after this?
}
```

### The Edit Tool (Most Complex)

The edit tool is the most important tool for a coding agent. Pi's edit tool:
- Accepts `oldText` and `newText` (exact replacement)
- Supports multiple disjoint edits in one call
- Has a file mutation queue to prevent concurrent write conflicts
- Validates that `oldText` is unique in the file (no ambiguous edits)

## 5. Session Management

Sessions persist the conversation across restarts.

### Pi's Session Structure

```
~/.pi/sessions/
  └── <session-id>.jsonl    # One JSONL file per session
```

Each line in the JSONL file is a session entry:
```typescript
type SessionEntry = 
  | { type: "header"; version: number; cwd: string; model: ... }
  | { type: "user"; message: UserMessage }
  | { type: "assistant"; message: AssistantMessage }
  | { type: "toolResult"; message: ToolResultMessage }
  | { type: "compaction"; messages: Message[]; details: ... }
  | { type: "branchSummary"; ... }
```

### Context Compaction

When the conversation grows too long for the model's context window, the agent:
1. Takes all messages up to a point
2. Asks the LLM to summarize them
3. Replaces old messages with a summary
4. Keeps recent messages intact

This is called **compaction**. It's essential for long-running coding sessions.

## 6. System Prompt Construction

The system prompt is built dynamically and includes:
- **Agent identity**: "You are a coding agent..."
- **Tool descriptions**: How to use each available tool
- **Guidelines**: Coding best practices, safety rules
- **Project context**: Files like README.md, AGENTS.md, .cursorrules
- **Date and working directory**: Current context
- **Skills**: Optional specialized instructions loaded from `.pi/agent/skills/`

## 7. Data Flow: End to End

```
User types: "Fix the bug in auth.ts"
                    │
                    ▼
    ┌───────────────────────────┐
    │ 1. Parse user input        │
    │    → CreateUserMessage     │
    └────────────┬──────────────┘
                 │
                 ▼
    ┌───────────────────────────┐
    │ 2. Build system prompt     │
    │    → Tools + guidelines   │
    │    → Project context       │
    │    → Skills                │
    └────────────┬──────────────┘
                 │
                 ▼
    ┌───────────────────────────┐
    │ 3. Convert messages        │
    │    AgentMessage[] →        │
    │    Message[] for LLM       │
    └────────────┬──────────────┘
                 │
                 ▼
    ┌───────────────────────────┐
    │ 4. Stream to provider      │
    │    POST /messages (stream) │
    │    ← token by token       │
    └────────────┬──────────────┘
                 │
                 ▼
    ┌───────────────────────────┐
    │ 5. Agent decides:          │
    │    "I need to read auth.ts"│
    │    → ToolCall: read()      │
    └────────────┬──────────────┘
                 │
                 ▼
    ┌───────────────────────────┐
    │ 6. Execute tool:           │
    │    read("auth.ts")         │
    │    → returns file content  │
    └────────────┬──────────────┘
                 │
                 ▼
    ┌───────────────────────────┐
    │ 7. Tool result sent back   │
    │    to LLM as context       │
    │    → Loop back to step 4   │
    └────────────┬──────────────┘
                 │
                 ▼
    ┌───────────────────────────┐
    │ 8. Agent decides:          │
    │    "I found the bug.       │
    │     Edit auth.ts line 42"  │
    │    → ToolCall: edit()      │
    └────────────┬──────────────┘
                 │
                 ▼
    ┌───────────────────────────┐
    │ 9. Execute edit, return    │
    │    result to LLM           │
    └────────────┬──────────────┘
                 │
                 ▼
    ┌───────────────────────────┐
    │ 10. Agent responds:        │
    │    "Fixed! The issue was   │
    │     a missing null check"  │
    │    → No more tool calls    │
    │    → Return to user        │
    └───────────────────────────┘
```

## 8. Key Patterns to Understand

### Event-Driven Architecture
All three agents use event-driven patterns. The agent loop emits events, and the UI subscribes to them. This decouples the core loop from rendering.

### Streaming Everywhere
Nothing waits for complete responses. Text streams token-by-token, tool calls stream their arguments, and tool results stream their output. This is what makes coding agents feel responsive.

### Type Safety
Both Pi and Mastra use TypeScript heavily with generics for type-safe tool definitions and message handling.

### Abort-First Design
Every async operation accepts an `AbortSignal`. The user can cancel at any point, and the agent handles this gracefully.
