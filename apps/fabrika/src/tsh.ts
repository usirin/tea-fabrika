import {run} from "@demlik/tea/effect";
import {
	type AnyRun,
	type AnyRunning,
	type Entry,
	Ledger,
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
import {Author, tracker} from "@tea-fabrika/tracker";
import {Deferred, Effect, Layer, Queue, Stream} from "effect";
import {type EditorMsg, editor} from "./editor/editor.ts";
import type {SharedHistory} from "./editor/history.ts";
import {readFromTerminal, readFromWindow, type ToTerminal, type ToWindow} from "./messages.ts";

// One tile's tsh: tsh, with its line editor, behind the tile's terminal, and a view for each run
// of a program that has one. It names no platform: it is handed the terminal's page and a way to
// tell its tile of its runs, so a test drives it with no Electron (tsh.test.ts). tiles.ts holds
// one per tile, in the host process (host/main.ts).
//
//   const tsh = yield* startTsh({jobs: memoryStorage(), history, runs});
//   const stop = tsh.terminal.show((m) => send(m));   // the screen so far, then each write
//   tsh.terminal.heard({type: "keys", data: "cou\t"});
//   // writes: "counter " goes on the line, as Tab put it in
//   tsh.terminal.heard({type: "keys", data: "\r"});
//   // runs.began("counter:1a2b", "counter", "foreground", screen): the counter covers the tile
//   screen.heard({type: "msg", msg: {type: "press", value: "plus"}});    // the count is 1
//   screen.closed();
//   // its view was closed: its inputs close, as stdin's end. It ends, tsh prints 1, the prompt is back
//
// It is a terminal and a shell, as on Unix (README, "Job control"):
//
//   - The terminal is the line editor's (editor/editor.ts): keys in, bytes out. tsh is handed a
//     whole line on Enter, as bash is by readline.
//   - A program with a view run in the foreground covers the tile, and the prompt waits for its
//     end. Ctrl-C in the terminal stops it, and its view goes.
//   - `counter &` runs in the background, as in bash: nothing is shown, and the prompt is back at
//     once. `attach %n` brings it to the foreground, as bash's `fg`: then it covers the tile.
//   - Closing a program's view closes its inputs: the program ends as it does on stdin's end.
//   - `close` gives tsh and every program it started the end of their inputs, as a terminal
//     closing hangs up its shell, but softer: nothing is stopped. The programs end on their own,
//     then tsh's line closes, and tsh ends. `ended` says when.
//
// Which programs tsh comes with is fixed here for now: the small ones, the counter and the
// tracker. Every run is seen as it starts (`seenBy`), so `close` can reach it. A run of one with
// a view is drawn: it tells its tile, shows the view its data on each change, and reads
// what the view sends by that program's inputs. Whether the run is in the foreground is read off
// tsh's job table, which tsh writes before the run starts, and again when `attach` moves it.
//
// Storage: it is handed where tsh keeps its jobs, as the terminal tsh is
// (packages/fabrika/src/shell/main.ts), and the history every tile shares. tiles.ts hands it a
// folder for its tile in the app's home; a test hands it memory. The next tsh on the same
// storage finds the jobs as "from an earlier tsh, not running", and `attach %n` starts one again
// where it left off, with its view.
//
// tsh's own run stays in memory, on purpose, as in the terminal: what outlives one tsh is its
// table, not its run.
//
// The ledger: it is handed one, as the `Ledger` service, and gives it to the tracker. The host
// process hands it a node:sqlite file in the app's home; a test hands it memory. The tracker
// writes as the owner, the one person at the app for now.
//
// A screen shows on any number of pages at once, as a tmux pane shows in every client attached:
// `show` adds one, and the function it answers takes it away again.

/** What became of a message from a page: read, and on its way, or refused, and why. */
export type Heard = {readonly kind: "read"} | {readonly kind: "refused"; readonly why: string};

/** A page, as tsh sees it. */
export interface Screen<To> {
	/**
	 * Show on this page too from now on, starting with what it shows now. Answers how to stop
	 * showing on it: a page closed, or loaded again, is shown again with a fresh call.
	 */
	readonly show: (page: (m: To) => void) => () => void;
	/** A message from the page: read, then acted on, in the order heard. One that does not read is refused. */
	readonly heard: (raw: unknown) => Heard;
}

/** A program's view, as the host sees it. */
export interface WindowScreen extends Screen<ToWindow> {
	/**
	 * The view was closed. The run's inputs close, as a terminal closes a program's stdin, and
	 * the program ends the way it ends on that. Said after the run ended, or while the host stops,
	 * it changes nothing: a host stopping leaves jobs to be attached at its next start.
	 */
	readonly closed: () => void;
}

/** In the foreground the run covers tsh's tile and tsh waits; in the background nothing shows it. */
export type Placed = "foreground" | "background";

/** What the host tells its tile of tsh's runs, for the edge to draw. */
export interface Runs {
	/** A run of `program` with a view started: `screen` is its view, shown when it is in the foreground. */
	readonly began: (run: string, program: string, placed: Placed, screen: WindowScreen) => void;
	/** A run with a view that began in the background is in the foreground now: `attach`, as `fg`. */
	readonly forward: (run: string) => void;
	/** That run ended: its view goes, if it is still shown. */
	readonly ended: (run: string) => void;
	/** How many of tsh's jobs run now. */
	readonly running: (count: number) => void;
}

export interface Tsh {
	/** The terminal's page: the bytes to draw, and the keys and size it sends. */
	readonly terminal: Screen<ToTerminal>;
	/**
	 * Give tsh and every program it started the end of their inputs. When the last of its jobs has
	 * ended, tsh's own line closes and tsh ends. Nothing is stopped: a program that does not end on
	 * its inputs' end runs on, until its scope closes. Said again, it changes nothing.
	 */
	readonly close: Effect.Effect<void>;
	/** Done when tsh has ended: `exit`, Ctrl-D on an empty line, or after `close`. */
	readonly ended: Effect.Effect<void>;
}

/** tsh's run. In memory, so each tile's tsh has the same id with no clash. */
export const TSH = "tsh:p1";

/** The bytes of the screen kept for a page loaded again, as a terminal's scrollback: the newest. */
export const SCREEN_KEPT = 256 * 1024;

/** The programs tsh comes with in the app, fixed for now: the small ones, and two with a view. */
const COUNTER = listed(counter, Layer.empty);
const trackerOn = (ledger: Ledger["Service"]) =>
	listed(
		tracker,
		Layer.mergeAll(
			Layer.succeed(Ledger, ledger),
			Layer.succeed(Author, {kind: "user", id: "owner"}),
		),
	);

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

/** What was heard, read already, for the line editor or for one run with a view. */
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

/** Where the job holding `run` was started: tsh notes the job before its runs start. */
const placedIn = (table: Shell.Jobs | null, run: string): Placed =>
	table?.jobs.find((job) => job.stages.some((st) => st.run === run))?.background === true
		? "background"
		: "foreground";

/** How many jobs of a table run now: started by this tsh, and not ended. */
const runningIn = (table: Shell.Jobs | null): number =>
	table?.jobs.filter((job) => job.state === "running").length ?? 0;

/** Start a tile's tsh: it keeps its jobs in `jobs`, and the line editor its history in `history`. The tracker writes on the `Ledger` it is given. */
export const startTsh = (options: {
	readonly jobs: Storage;
	readonly history: SharedHistory;
	readonly runs: Runs;
}) =>
	Effect.gen(function* () {
		const {jobs, history, runs} = options;
		const scope = yield* Effect.scope;
		const ledger = yield* Ledger;
		/** Its scope is closing: the tile closes or the host stops, and every run stops with it. */
		let closing = false;
		/** tsh's job table now, read as a run is seen. Set once tsh started; no run starts before. */
		let table: () => Shell.Jobs | null = () => null;
		/** Every run tsh started that has not ended, by id, so `close` reaches each. */
		const all = new Map<string, AnyRunning>();
		/** Where each run with a view is now, by id: one in the background is not drawn. */
		const shown = new Map<string, {placed: Placed}>();
		/** `close` was said: every input ends, and tsh's line too once no job runs. */
		let hungUp = false;
		/** Every input of a run ends, as stdin's end: what it does then is its own. */
		const endInputs = (running: AnyRunning) => {
			for (const name of Object.keys(running.run.program.inputs)) running.close(name);
		};

		// What the editor and the views are told, on one queue, in the order it was heard.
		const inbox = yield* Queue.unbounded<Told>();
		const toEditor = (msg: EditorMsg) => Queue.offerUnsafe(inbox, {to: "editor", msg});

		// The terminal's screen: each write goes to every page, and is kept for a page loaded again.
		let screen = "";
		const pages = new Set<(m: ToTerminal) => void>();
		const write = (data: string) => {
			screen = kept(screen + data);
			for (const page of pages) page({type: "write", data});
		};

		/** A run of a program with a view: its tile is told, its view is shown each change, and it goes at the end. */
		const opened = (running: AnyRunning) =>
			Effect.gen(function* () {
				const {run: r} = running;
				const declared = viewOf(r.program);
				const machine = declared === undefined ? undefined : r.machines[declared.machine];
				if (declared === undefined || machine === undefined) return;
				let newest: ToWindow | null = null;
				const shownOn = new Set<(m: ToWindow) => void>();
				let over = false;
				const window: WindowScreen = {
					show: (next) => {
						const one = (m: ToWindow) => next(m);
						shownOn.add(one);
						if (newest !== null) one(newest);
						return () => shownOn.delete(one);
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
				const placed = placedIn(table(), r.id);
				shown.set(r.id, {placed});
				runs.began(r.id, r.program.name, placed, window);
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
							for (const page of shownOn) page(view);
						}),
					),
					Effect.ensuring(
						Effect.sync(() => {
							over = true;
							shown.delete(r.id);
							runs.ended(r.id);
						}),
					),
					Effect.forkIn(scope),
				);
			});

		/** A run tsh started, by any path: kept for `close` until it ends, and drawn if it has a view. */
		const seen = (running: AnyRunning) =>
			Effect.gen(function* () {
				all.set(running.run.id, running);
				yield* running.run.ended.pipe(
					Effect.ensuring(Effect.sync(() => all.delete(running.run.id))),
					Effect.forkIn(scope),
				);
				// Started after `close`, as a line typed in a closing tile: its inputs end at once too.
				if (hungUp) endInputs(running);
				yield* opened(running);
			});

		const programs = Shell.programList(
			[...Shell.SMALL, COUNTER, trackerOn(ledger)].map((entry) => seenBy(entry, seen)),
		);
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
		table = () => started.run.machines.jobs.state();
		// Added after tsh started, so it runs before tsh stops: no view closed by the quit closes an input.
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				closing = true;
			}),
		);

		/** tsh's own inputs end: its line, as Ctrl-D, and Ctrl-C's. Every job of it has ended by now. */
		const endTsh = () => {
			started.close("line");
			started.close("signal");
		};

		const over = yield* Deferred.make<void>();
		yield* started.run.ended.pipe(
			Effect.andThen(Effect.sync(() => toEditor({type: "ended"}))),
			Effect.andThen(Deferred.succeed(over, undefined)),
			Effect.forkScoped,
		);
		yield* started.run.machines.jobs.changes.pipe(
			Stream.runForEach((jobs) =>
				Effect.sync(() => {
					if (jobs === null) return;
					toEditor({type: "jobs", jobs});
					// `attach %n` moved a job of the background to the foreground: its view covers the tile now.
					for (const [run, where] of shown)
						if (where.placed === "background" && placedIn(jobs, run) === "foreground") {
							where.placed = "foreground";
							runs.forward(run);
						}
					const count = runningIn(jobs);
					runs.running(count);
					if (hungUp && count === 0) endTsh();
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
		// Every tile's editor hears each save, its own too, so a line typed anywhere is in its Ctrl-R.
		const unfollow = history.follow((lines) => toEditor({type: "history", lines}));
		yield* Effect.addFinalizer(() => Effect.sync(unfollow));

		// What was heard, told in order by one fiber.
		const tellOne = (told: Told) =>
			told.to === "editor"
				? editing.dispatch(told.msg).pipe(Effect.orDie)
				: // Offered, not told: a press is never dropped on a full input. A run that ended
					// meanwhile answers `stopped`, and the press goes nowhere, as it should.
					told.run.offer(told.msg.type, told.msg.value).pipe(Effect.asVoid);
		yield* Queue.take(inbox).pipe(Effect.flatMap(tellOne), Effect.forever, Effect.forkScoped);

		const tsh: Tsh = {
			terminal: {
				show: (next) => {
					const one = (m: ToTerminal) => next(m);
					pages.add(one);
					if (screen !== "") one({type: "write", data: screen});
					return () => pages.delete(one);
				},
				heard: (raw) => {
					const read = readFromTerminal(raw);
					if (read.kind === "refused") return read;
					const {msg} = read;
					toEditor(msg.type === "keys" ? msg : {type: "size", cols: msg.cols});
					return {kind: "read"};
				},
			},
			close: Effect.sync(() => {
				if (hungUp) return;
				hungUp = true;
				for (const running of all.values()) endInputs(running);
				if (runningIn(table()) === 0) endTsh();
			}),
			ended: Deferred.await(over),
		};
		return tsh;
	});
