// `@kampus/fabrika/agents/program`: `claude` and `codex` as tea programs, on
// the `Agents` service (experiment 169). One function makes both; a Draft's
// runner starts one as a child run. The two fake makers are here too, so a
// stage's test runs on both. No platform and no maker's SDK is named here.

export * from "./program/conversation.ts";
export * from "./program/fakes.ts";
export * from "./program/program.ts";
