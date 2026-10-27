// The agent interface, at the top level as `Agent` (experiment 156): our own
// interface to a coding agent, its shapes taken from ACP. The service, what
// it adds once for every adapter, the session map, the fake adapter, and a
// Draft's runner on it. No platform is named here: the adapters for Claude's
// SDK, for Codex and for ACP are on `/agents/claude`, `/agents/codex` and
// `/agents/acp`, and each of them carries `psReaper`, which ends child processes.
export * from "./agent/core.ts";
export * from "./agent/draft.ts";
export * from "./agent/fake.ts";
export * from "./agent/sessions.ts";
export * from "./agent/turn.ts";
