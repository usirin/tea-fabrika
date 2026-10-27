// `@kampus/fabrika/agents/claude`: Claude Code through the Agent SDK. A
// Draft over the SDK's stream, the schema its answer is read by, and the
// guard each of its tool calls passes. The guard is on `/agents/sandbox` too,
// with the sandbox and the environment, for a process that must not load the
// SDK. An agent's spans are on `/agents/trace`.

export {psReaper} from "./agent/reap.ts";
export * from "./claude/adapter.ts";
export * from "./claude/draft.ts";
export * from "./claude/schema.ts";
export * from "./claude/shell-guard.ts";
