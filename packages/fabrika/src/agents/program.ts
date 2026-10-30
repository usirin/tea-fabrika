// `@kampus/fabrika/agents/program`: what the `claude` and `codex` programs
// share (experiment 169). Each program is its own package in `programs/`,
// with one `defineProgram`; here are the parts it wires: the kept
// conversation and its kind, the flags, inputs and outputs, `chat` (the main
// both run), a Draft's runner that starts one as a child run, and the two
// fake providers, so a test runs on both. No platform and no maker's SDK is
// named here.

export * from "./program/chat.ts";
export * from "./program/conversation.ts";
export * from "./program/fakes.ts";
export * from "./program/runner.ts";
