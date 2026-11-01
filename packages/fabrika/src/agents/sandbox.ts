// `@kampus/fabrika-old/agents/sandbox`: what an agent's process may see, read and
// do. The environment it is handed (a keep-list of names), the folders and
// tools of the sandbox it runs in, the rule files it reads and the settings
// it does not, and the guard on each tool call. Plain
// functions over Node: no Agent SDK is loaded here, so a hook run once per
// tool call starts in about 50 ms, not 300.
export * from "./claude/env.ts";
export * from "./claude/rules.ts";
export * from "./claude/sandbox.ts";
export * from "./claude/shell-guard.ts";
