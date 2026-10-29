// `@kampus/fabrika`, the top level: the services and the code that runs
// anywhere, in a browser too. No platform is named here. Each platform's
// implementation is a Layer on a subpath (`/memory`, `/sqlite`, `/http`,
// `/local`, `/storage/node`, `/otel`, `/shell`, `/agents/claude`,
// `/agents/sandbox`, `/agents/trace`, `/agents/acp`, `/sandbox/os`), and a program picks its
// layers where it starts. `browser-check.ts` bundles this file for the browser
// and fails on any `node:*`, Miniflare, Agent SDK, ACP or OpenTelemetry module
// it pulls in (`pnpm lint` runs it).
//
// The work pipeline is not here: since experiment 114 it is its own package,
// `@kampus/pipeline`, an app built on this one's public names alone.
//
// Two old packages became one flat list, and some names were in both. The two
// Elm modules stay modules, as Elm writes them: `Call.update`, `Monitor.update`.
// The other names in two places are picked below; the one not picked is used
// by no import outside its own part today (experiment 103).

// agents: our own interface to a coding agent (experiment 156). Its adapters are on subpaths.
export * as Agent from "./agents/agent.ts";
// host: programs under registered names on one ledger.
export * as Call from "./host/call.ts";
export * from "./host/dead-letters.ts";
// The door: who a request is. It runs inside the ledger (`durable-object.ts`); these are the
// names a host needs to build what gets signed, and to read what the door says. A program's facts
// say who writes each (`Writes`), held to the kinds only a person writes (`PERSON_KINDS`).
export {
	challengeText,
	DOOR,
	type Grant,
	grantOf,
	grantText,
	holderOf,
	hostOf,
	isAgentName,
	isName,
	isPersonId,
	isPersonKind,
	MEMBERS,
	NAMESPACE,
	namesOf,
	PERSON_KINDS,
	type PersonKind,
	type Stamp,
	stampText,
	type Writes,
} from "./host/door.ts";
export * from "./host/host.ts";
// A host's jobs: the one table a host keeps and every tsh on it shows. The table's own parts
// (`Jobs`, `EMPTY`) are on `Shell`, where a line editor reads them.
export {HostJobs, type JobsOnHost, type JobTable, openJobs} from "./host/host-jobs.ts";
export {traceIdOf} from "./host/jobs.ts";
// Where the door gets a person's keys: the service it asks, for a Layer written elsewhere.
export * from "./host/keys.ts";
export * from "./host/leader.ts";
export * from "./host/ledger.ts";
// Names in two places. The ledger's records win over the host's and the
// rules' plain types of the same name, which they encode.
export {DeadLetter, EndReason, Fenced, LimitKind, Over, Stale} from "./host/ledger.ts";
export * as Monitor from "./host/monitor.ts";
// Moving a project: the plan on the laptop, the import window on the server's door.
export * from "./host/move.ts";
export * from "./host/observer.ts";
export * from "./host/rules.ts";
export * from "./host/signer.ts";
export {type KeyFile, keyFileOf, keyFileText, keyLineOf, keyOnly} from "./host/sshsig.ts";
export * from "./host/supervisor.ts";
export * from "./host/tail.ts";
export * from "./host/writer.ts";
// program: a tea machine as a program.
export * from "./program/ear.ts";
// The kept run's types appear in what `defineProgram` hands back, so an app's
// declarations name them (experiment 114: the pipeline's build needs them).
export type {KeptFailed, KeptOptions} from "./program/kept.ts";
export * from "./program/listed.ts";
export * from "./program/mortal.ts";
// A program's run, and how a host lists its flags, win over the supervisor's
// and the storage's records of the same name.
export type {Ended, Listed, Run, Started} from "./program/program.ts";
export * from "./program/program.ts";
export * from "./program/shape.ts";
export * from "./program/storage.ts";
// The storage's `Stale` lost its name to the ledger's above, but a program's
// failure type holds it, so an app's declarations must name it: here it is
// `StorageStale`. Its tag is still "Stale" (experiment 114).
export {Stale as StorageStale} from "./program/storage.ts";
export * from "./program/trace.ts";
export * from "./program/view.ts";
// sandbox: the sandbox a program runs in, and its `none` version. The `os` one is on `/sandbox/os`.
export * as Sandbox from "./sandbox/sandbox.ts";
// shell: tsh's parts that run anywhere, as one module. Its launcher is on `/shell`.
export * as Shell from "./shell/index.ts";
