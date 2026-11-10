// The new fabrika's library, its app layer (Tier 1, P11): programs, their saved state, view
// patches and the runner that steps a process. Browser-safe: it reaches no platform.
export * as Id from "./id.ts";
export {IdError, type IdSchema, type IdValue} from "./id.ts";
export {
	Alarm,
	CheckedWriter,
	type Handler,
	Incoming,
	type Loaded,
	ProgramLoader,
	Recording,
	type Update,
	type View,
	WatcherManager,
} from "./app/entry.ts";
export {diff, type Patch} from "./app/patch.ts";
export {
	FactPolicy,
	Input,
	Program,
	ProgramDown,
	Refusal,
	State,
	Step,
	type Stepper,
	stepper,
	Write,
} from "./app/program.ts";
export {type Descriptor, type Opened, ProgramRunner, RunnerError, Sent} from "./app/runner.ts";
export {Saved} from "./app/state.ts";
export {
	Declaration,
	type Execution,
	type ExecutionCalls,
	nodeExecution,
	workerExecution,
} from "./app/execution.ts";
export {Door, type ConnectionId} from "./door/index.ts";
// A program client's own rules (P14): the client machine's factory, with pending letters and checked
// views. Any client steps it: a browser tab, Electron, headless.
export * as ProgramClient from "./app/client.ts";
// A program window's typed contract, and the rows a client records (P14).
export {
	ClientRecord,
	ClientRow,
	commandMsg,
	defineWindow,
	type WindowData,
	type WindowMsg,
	type WindowProps,
	type WindowRegistration,
} from "./app/window.ts";
export {applyPatch, PatchError} from "./app/patch.ts";
// Key tables (P14): the person's key file, the rows over a program's defaults, and the match.
export * as Keys from "./app/keybindings.ts";
export type {Armed, KeyEvent, KeyProblem, Rows, Table} from "./app/keybindings.ts";
