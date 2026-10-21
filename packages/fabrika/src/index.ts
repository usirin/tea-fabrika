// `@kampus/fabrika`, the top level: the services and the code that runs
// anywhere, in a browser too. No platform is named here. Each platform's
// implementation is a Layer on a subpath (`/memory`, `/sqlite`, `/http`,
// `/local`, `/storage/node`, `/otel`, `/agents/claude`, `/agents/acp`), and
// a program picks its layers where it starts. `browser-check.ts` bundles this
// file for the browser and fails on any `node:*`, Miniflare, Agent SDK, ACP or
// OpenTelemetry module it pulls in (`pnpm lint` runs it).
//
// The pipeline is not here yet: it is experimental, and on `/pipeline/*`.
//
// Two old packages became one flat list, and some names were in both. The two
// Elm modules stay modules, as Elm writes them: `Call.update`, `Monitor.update`.
// The other names in two places are picked below; the one not picked is used
// by no import outside its own part today (experiment 103).

// host: programs under registered names on one ledger.
export * as Call from "./host/call.ts";
export * from "./host/dead-letters.ts";
export * from "./host/host.ts";
export * from "./host/ledger.ts";
// Names in two places. The ledger's records win over the host's and the
// rules' plain types of the same name, which they encode.
export {DeadLetter, EndReason, Fenced, LimitKind, Over, Stale} from "./host/ledger.ts";
export * as Monitor from "./host/monitor.ts";
export * from "./host/observer.ts";
export * from "./host/rules.ts";
export * from "./host/supervisor.ts";
export * from "./host/tail.ts";
// program: a tea machine as a program.
export * from "./program/ear.ts";
export * from "./program/listed.ts";
export * from "./program/mortal.ts";
// A program's run, and how a host lists its flags, win over the supervisor's
// and the storage's records of the same name.
export type {Ended, Listed, Run, Started} from "./program/program.ts";
export * from "./program/program.ts";
export * from "./program/shape.ts";
export * from "./program/storage.ts";
export * from "./program/trace.ts";
