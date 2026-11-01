// `@kampus/fabrika-old/agents/codex`: Codex through `codex exec --json`, as an
// adapter of the agent interface (`Agent` at the top level), contained with
// its own home, a keep-list environment, a permission profile and the plan check.

export {codexHomeOf} from "./acp/harness.ts";
export * from "./agent/reap.ts";
export * from "./codex/adapter.ts";
