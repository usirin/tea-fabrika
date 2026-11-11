// The new fabrika's library, its app layer (Tier 1, P11): programs, their saved state, view
// patches and the runner that steps a process. Browser-safe: it reaches no platform.
export * as Id from "./Id.ts";
export { IdError, type IdSchema, type IdValue } from "./Id.ts";
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
} from "./runtime/Entry.ts";
export { diff, type Patch } from "./runtime/Patch.ts";
export {
  EventPolicy,
  Input,
  Program,
  ProgramDown,
  Refusal,
  State,
  Step,
  type Stepper,
  stepper,
  Write,
} from "./runtime/Program.ts";
export { type Descriptor, type Opened, ProgramRunner, RunnerError, Sent } from "./runtime/Runner.ts";
export { Saved } from "./runtime/State.ts";
export {
  Declaration,
  type Execution,
  type ExecutionCalls,
  nodeExecution,
  workerExecution,
} from "./runtime/Execution.ts";
export { Gateway, type ConnectionId } from "./gateway/Gateway.ts";
// A program client's own rules (P14): the client machine's factory, with pending letters and checked
// views. Any client steps it: a browser tab, Electron, headless.
export * as ProgramClient from "./runtime/Client.ts";
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
} from "./runtime/Window.ts";
export { applyPatch, PatchError } from "./runtime/Patch.ts";
// Key tables (P14): the person's key file, the rows over a program's defaults, and the match.
export * as Keys from "./runtime/Keybindings.ts";
export type { Armed, KeyEvent, KeyProblem, Rows, Table } from "./runtime/Keybindings.ts";
