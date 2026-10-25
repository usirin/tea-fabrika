import {run} from "@demlik/tea/effect";
import {
	type AnyRun,
	type AnyRunning,
	type Entry,
	listed,
	memoryStorage,
	offer,
	readInput,
	Shell,
	type Storage,
	start,
	tell,
	viewOf,
} from "@kampus/fabrika";
import {counter} from "@tea-fabrika/counter";
import {Deferred, Effect, Layer, Queue, Stream} from "effect";
import {type EditorMsg, editor} from "./editor/editor.ts";
import type {History} from "./editor/history.ts";
import {readFromTerminal, readFromWindow, type ToTerminal, type ToWindow} from "./messages.ts";

// The app's host: tsh, with its line editor, behind a terminal, and a window for each run of a
// program that has one. It names no platform: it is handed the terminal's page and a way to open
// and close windows, so a test drives it with no Electron (host.test.ts). main.ts is the
// Electron edge that wires it to real windows.
//
//   const host = yield* startHost({jobs: memoryStorage(), history: memoryHistory(), windows});
//   host.terminal.show((m) => port.postMessage(m));   // the screen so far, then each write
//   host.terminal.heard({type: "keys", data: "cou\t"});
//   // writes: "counter " goes on the line, as Tab put it in
//   host.terminal.heard({type: "keys", data: "\r"});
//   // windows.open("counter:1a2b", "counter", screen): the counter's window opens, and the prompt waits
//   screen.heard({type: "msg", msg: {type: "press", value: "plus"}});    // the count is 1
//   screen.closed();
//   // the person closed it: its inputs close, as stdin's end. It ends, tsh prints 1, the prompt is back
//
// It is a terminal and a shell, as on Unix (README, "Job control"):
//
//   - The terminal is the line editor's (editor/editor.ts): keys in, bytes out. tsh is handed a
//     whole line on Enter, as bash is by readline.
//   - A program with a window run in the foreground opens its window, and the prompt waits for
//     its end. Ctrl-C in the terminal stops it; its window closes.
//   - `counter &` opens its window and gives the prompt back at once.
//   - Closing a program's window closes its inputs: the program ends as it does on stdin's end.
//
// Which programs tsh comes with is fixed here for now: the small ones and the counter. A run
// of one with a window is seen as it starts (`seenBy`): the host opens its window, shows it its
// view's data on each change, and reads what its window sends by that program's inputs.
//
// Storage: the host is handed where tsh keeps its jobs, as the terminal tsh is
// (packages/fabrika/src/shell/main.ts), and where the line editor keeps its history. main.ts
// hands it files in the app's home; a test hands it memory. The next host on the same storage
// finds the jobs as "from an earlier tsh, not running", and `attach %n` starts one again where
// it left off, with its window.
//
// tsh's own run stays in memory, on purpose, as in the terminal: what outlives one tsh is its
// table, not its run. No ledger is used, so no worker thread and no child process.

/** What became of a message from a page: read, and on its way, or refused, and why. */
export type Heard = {readonly kind: "read"} | {readonly kind: "refused"; readonly why: string};

/** A window's page, as the host sees it. */
export interface Screen<To> {
	/** Show on this page from now on, starting with what it shows now. A page loaded again is shown again. */
	readonly show: (page: (m: To) => void) => void;
	/** A message from the page: read, then acted on, in the order heard. One that does not read is refused. */
	readonly heard: (raw: unknown) => Heard;
}

/** A program's window, as the host sees it. */
export interface WindowScreen extends Screen<ToWindow> {
	/**
	 * The person closed the window. The run's inputs close, as a terminal closes a program's
	 * stdin, and the program ends the way it ends on that. Said after the run ended, or while the
	 * app quits, it changes nothing: quitting leaves jobs to be attached at the next start.
	 */
	readonly closed: () => void;
}

/** The windows of the runs with one, as the edge opens and closes them. */
export interface Windows {
	/** A run of `program` with a window started: open one, and show `screen` on it. */
	readonly open: (run: string, program: string, screen: WindowScreen) => void;
	/** That run ended: close its window, if it is still open. */
	readonly close: (run: string) => void;
}

export interface Host {
	/** The terminal's page: the bytes to draw, and the keys and size it sends. */
	readonly terminal: Screen<ToTerminal>;
	/** Done when tsh has ended: `exit`, or Ctrl-D on an empty line. */
	readonly ended: Effect.Effect<void>;
}

/** tsh's run. */
export const TSH = "tsh:p1";

/** The bytes of the screen kept for a page loaded again, as a terminal's scrollback: the newest. */
export const SCREEN_KEPT = 256 * 1024;

/** The programs tsh comes with in the app, fixed for now: the small ones, and one with a window. */
const COUNTER = listed(counter, Layer.empty);

/** An entry whose runs are handed to `seen` as they start, however tsh starts them. */
const seenBy = (entry: Entry, seen: (running: AnyRunning) => Effect.Effect<void>): Entry => ({
	...entry,
	start: (flags, listeners, keeping) =>
		entry
			.start(flags, listeners, keeping)
			.pipe(Effect.tap((s) => (s.kind === "running" ? seen(s) : Effect.void))),
	pipe: (flags, listeners, keeping, output, to, input) =>
		entry
			.pipe(flags, listeners, keeping, output, to, input)
			.pipe(Effect.tap((s) => (s.kind === "running" ? seen(s) : Effect.void))),
});

/** What was heard, read already, for the line editor or for one run with a window. */
type Told =
	| {readonly to: "editor"; readonly msg: EditorMsg}
	| {
			readonly to: "window";
			readonly run: AnyRun;
			readonly msg: {readonly type: string; readonly value: unknown};
	  };

/** The newest `SCREEN_KEPT` of a screen's bytes, cut at a row's start, so no escape sequence is cut in two. */
const kept = (screen: string): string => {
	if (screen.length <= SCREEN_KEPT) return screen;
	const tail = screen.slice(-SCREEN_KEPT);
	return tail.slice(tail.indexOf("\n") + 1);
};

/** Start the host: tsh keeps its jobs in `jobs`, and the line editor its history in `history`. */
export const startHost = (options: {
	readonly jobs: Storage;
	readonly history: History;
	readonly windows: Windows;
}) =>
	Effect.gen(function* () {
		const {jobs, history, windows} = options;
		const scope = yield* Effect.scope;
		/** The host's scope is closing: the app quits, and every run stops with it. */
		let closing = false;

		// What the editor and the windows are told, on one queue, in the order it was heard.
		const inbox = yield* Queue.unbounded<Told>();
		const toEditor = (msg: EditorMsg) => Queue.offerUnsafe(inbox, {to: "editor", msg});

		// The terminal's screen: each write goes to the page, and is kept for a page loaded again.
		let screen = "";
		let page: ((m: ToTerminal) => void) | null = null;
		const write = (data: string) => {
			screen = kept(screen + data);
			page?.({type: "write", data});
		};

		/** A run of a program with a window: its window opens, is shown each change of its view, and closes at its end. */
		const opened = (running: AnyRunning) =>
			Effect.gen(function* () {
				const {run: r} = running;
				const declared = viewOf(r.program);
				const machine = declared === undefined ? undefined : r.machines[declared.machine];
				if (declared === undefined || machine === undefined) return;
				let newest: ToWindow | null = null;
				let shownOn: ((m: ToWindow) => void) | null = null;
				let over = false;
				const window: WindowScreen = {
					show: (next) => {
						shownOn = next;
						if (newest !== null) next(newest);
					},
					heard: (raw) => {
						const envelope = readFromWindow(raw);
						if (envelope.kind === "refused") return envelope;
						const input = readInput(r.program, envelope.msg.msg);
						if (input.kind === "refused") return input;
						Queue.offerUnsafe(inbox, {to: "window", run: r, msg: input.msg});
						return {kind: "read"};
					},
					closed: () => {
						if (over || closing) return;
						for (const name of Object.keys(r.program.inputs)) running.close(name);
					},
				};
				windows.open(r.id, r.program.name, window);
				yield* machine.changes.pipe(
					Stream.filter((state) => state !== null),
					Stream.runForEach((state) =>
						Effect.sync(() => {
							const view: ToWindow = {
								type: "view",
								program: r.program.name,
								data: declared.of(state),
							};
							newest = view;
							shownOn?.(view);
						}),
					),
					Effect.ensuring(
						Effect.sync(() => {
							over = true;
							windows.close(r.id);
						}),
					),
					Effect.forkIn(scope),
				);
			});

		const programs = Shell.programList([...Shell.SMALL, seenBy(COUNTER, opened)]);
		const started = yield* start(
			Shell.tsh,
			{show: "short"},
			{
				printed: (p) => toEditor({type: "printed", text: p.text}),
				ready: () => toEditor({type: "ready"}),
			},
			{id: TSH, storage: memoryStorage()},
		).pipe(
			Effect.provideService(Shell.Programs, programs),
			Effect.provideService(Shell.JobStorage, jobs),
		);
		// tsh's flags are this file's own: a refusal here is a mistake in it, not something to show.
		if (started.kind !== "running")
			return yield* Effect.die(`tsh refused its flags: ${started.why}`);
		// Added after tsh started, so it runs before tsh stops: no window closed by the quit closes an input.
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				closing = true;
			}),
		);

		const over = yield* Deferred.make<void>();
		yield* started.run.ended.pipe(
			Effect.andThen(Effect.sync(() => toEditor({type: "ended"}))),
			Effect.andThen(Deferred.succeed(over, undefined)),
			Effect.forkScoped,
		);
		yield* started.run.machines.jobs.changes.pipe(
			Stream.runForEach((jobs) =>
				Effect.sync(() => {
					if (jobs !== null) toEditor({type: "jobs", jobs});
				}),
			),
			Effect.forkScoped,
		);

		const lines = yield* history.load;
		const editing = yield* (yield* run(editor, {
			ctx: {programs, history: lines},
			interpret: {
				write: (c) => Effect.sync(() => write(c.data)).pipe(Effect.as(null)),
				// Offered, not told: a line a person typed is never dropped, even on a full input.
				line: (c) => offer(started.run, "line", c.text).pipe(Effect.as(null)),
				// A full `signal` line already holds an interrupt tsh has not read: this one is let go.
				interrupt: () =>
					tell(started.run, "signal", "interrupt").pipe(
						Effect.catchTag("Full", () => Effect.void),
						Effect.as(null),
					),
				close: () => Effect.sync(() => started.close("line")).pipe(Effect.as(null)),
				keep: (c) => history.save(c.lines).pipe(Effect.as(null)),
			},
		})).ready;

		// What was heard, told in order by one fiber.
		const tellOne = (told: Told) =>
			told.to === "editor"
				? editing.dispatch(told.msg).pipe(Effect.orDie)
				: // Offered, not told: a press is never dropped on a full input. A run that ended
					// meanwhile answers `stopped`, and the press goes nowhere, as it should.
					told.run.offer(told.msg.type, told.msg.value).pipe(Effect.asVoid);
		yield* Queue.take(inbox).pipe(Effect.flatMap(tellOne), Effect.forever, Effect.forkScoped);

		const host: Host = {
			terminal: {
				show: (next) => {
					page = next;
					if (screen !== "") next({type: "write", data: screen});
				},
				heard: (raw) => {
					const read = readFromTerminal(raw);
					if (read.kind === "refused") return read;
					const {msg} = read;
					toEditor(msg.type === "keys" ? msg : {type: "size", cols: msg.cols});
					return {kind: "read"};
				},
			},
			ended: Deferred.await(over),
		};
		return host;
	});
