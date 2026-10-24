import {run} from "@demlik/tea/effect";
import {
	type AnyRun,
	type AnyRunning,
	type Entry,
	type InputMsgOf,
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
import {Effect, Layer, Queue, Stream} from "effect";
import {type PaneView, type Read, readFromPage, type ToPage} from "./messages.ts";
import {type PaneMsg, paneMachine} from "./pane.ts";

// The app's host: one pane, running tsh with the app's programs. A program tsh starts that has
// a window takes over the pane until it ends. The host names no platform: it is handed a page to
// show views on and told what the page sent, so a test drives it with no Electron
// (host.test.ts). main.ts is the Electron edge that wires it to a window.
//
//   const host = yield* startHost(memoryStorage());
//   host.show((m) => port.postMessage(m));        // the pane's view now, then on each change
//   host.heard({type: "msg", pane: "p1", to: "tsh:p1", msg: {type: "line", value: "counter"}});
//   // views: tsh busy, then front [{program: "counter", run: "counter:...", data: {n: 0}}]
//   host.heard({type: "msg", pane: "p1", to: "counter:...", msg: {type: "press", value: "plus"}});
//   // a view with data {n: 1}; "done" ends it: the front goes, tsh prints 1 and is ready
//   host.heard({type: "msg", pane: "p1", to: "gone:1", msg: {type: "press", value: "plus"}});
//   // {kind: "refused", why: "no run gone:1 is shown here"}: nothing is told
//
// Which programs tsh comes with is fixed here for now: the small ones and the counter. A run
// of one with a window is seen as it starts (`seenBy`): the host shows its view's data over tsh
// and reads what its window sends by that program's inputs.
//
// Storage: the host is handed where tsh keeps its jobs, as the terminal tsh is
// (packages/fabrika/src/shell/main.ts). main.ts hands it a folder in the app's home; a test hands
// it memory, or one folder to two hosts in turn. What it keeps is tsh's job table and each job's
// own record and machines. The next host on the same storage finds them as "from an earlier tsh,
// not running", and `attach %n` starts one again where it left off:
//
//   const host = yield* startHost(fileStorage(dir));    // counter, +1, then the app quits
//   const next = yield* startHost(fileStorage(dir));    // tsh: 1 job from an earlier tsh, not running: %1. ...
//   next.heard({type: "msg", pane: "p1", to: "tsh:p1", msg: {type: "line", value: "attach %1"}});
//   // a view with front [{program: "counter", ..., data: {n: 1}}]
//
// tsh's own run stays in memory, on purpose, as in the terminal: what outlives one tsh is its
// table, not its run. No ledger is used, so no worker thread and no child process.

/** Where views go: the page, or whatever stands in for it. */
export type Page = (m: ToPage) => void;

/** What became of a message from the page: read, and on its way to its run, or refused, and why. */
export type Heard = {readonly kind: "read"} | {readonly kind: "refused"; readonly why: string};

export interface Host {
	/** Show views on this page from now on, starting with the pane as it is now. A page reloaded is shown again. */
	readonly show: (page: Page) => void;
	/** A message from the page: read, then told to the run it names, in the order heard. One that does not read is refused. */
	readonly heard: (raw: unknown) => Heard;
}

/** tsh's run in the one pane. */
export const TSH = "tsh:p1";

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

/** What the page sent, read already, for one run. */
type Told =
	| {readonly to: "tsh"; readonly msg: InputMsgOf<typeof Shell.tsh>}
	| {
			readonly to: "front";
			readonly run: AnyRun;
			readonly msg: {readonly type: string; readonly value: unknown};
	  };

/** Start the host, with tsh keeping its job table and its jobs in `jobs`. */
export const startHost = (jobs: Storage) =>
	Effect.gen(function* () {
		const scope = yield* Effect.scope;
		const pane = yield* (yield* run(paneMachine, {ctx: {run: TSH}})).ready;
		let page: Page | null = null;
		const view = (data: PaneView): ToPage => ({type: "view", pane: "p1", data});
		const draw = () => page?.(view(pane.getState()));
		/** Fold what was heard into the pane, in order, then draw it once. */
		const fold = (msgs: readonly PaneMsg[]) =>
			Effect.forEach(msgs, (m) => pane.dispatch(m), {concurrency: 1, discard: true}).pipe(
				Effect.orDie,
				Effect.andThen(Effect.sync(draw)),
			);

		// What tsh and the fronts say, on one queue, folded by one fiber: a burst is drawn once.
		const said = yield* Queue.unbounded<PaneMsg>();

		/** The runs with a window now, by run id: where a message from their window goes. */
		const fronts = new Map<string, AnyRun>();
		/** A run of a program with a window: shown over tsh, each time its view changes, until it ends. */
		const opened = (running: AnyRunning) =>
			Effect.gen(function* () {
				const {run: r} = running;
				const declared = viewOf(r.program);
				const machine = declared === undefined ? undefined : r.machines[declared.machine];
				if (declared === undefined || machine === undefined) return;
				fronts.set(r.id, r);
				yield* machine.changes.pipe(
					Stream.filter((state) => state !== null),
					Stream.runForEach((state) =>
						Queue.offer(said, {
							type: "drew",
							program: r.program.name,
							run: r.id,
							data: declared.of(state),
						}),
					),
					Effect.ensuring(
						Effect.sync(() => fronts.delete(r.id)).pipe(
							Effect.andThen(Queue.offer(said, {type: "left", run: r.id})),
						),
					),
					Effect.forkIn(scope),
				);
			});

		const programs = Shell.programList([...Shell.SMALL, seenBy(COUNTER, opened)]);
		const started = yield* start(
			Shell.tsh,
			{show: "short"},
			{
				printed: (p) => Queue.offerUnsafe(said, {type: "printed", to: p.to, text: p.text}),
				ready: (r) => Queue.offerUnsafe(said, {type: "ready", status: r.status}),
			},
			{id: TSH, storage: memoryStorage()},
		).pipe(
			Effect.provideService(Shell.Programs, programs),
			Effect.provideService(Shell.JobStorage, jobs),
		);
		// tsh's flags are this file's own: a refusal here is a mistake in it, not something to show.
		if (started.kind !== "running")
			return yield* Effect.die(`tsh refused its flags: ${started.why}`);
		yield* started.run.ended.pipe(
			Effect.flatMap((ended) => Queue.offer(said, {type: "ended", how: ended.kind})),
			Effect.forkScoped,
		);
		yield* Queue.takeAll(said).pipe(Effect.flatMap(fold), Effect.forever, Effect.forkScoped);

		// What the page sent, read already, told in order by one fiber.
		const inbox = yield* Queue.unbounded<Told>();
		const tellOne = (told: Told) => {
			if (told.to === "front")
				// Offered, not told: a press is never dropped on a full input. A run that ended
				// meanwhile answers `stopped`, and the press goes nowhere, as it should.
				return told.run.offer(told.msg.type, told.msg.value).pipe(Effect.asVoid);
			const {msg} = told;
			return msg.type === "line"
				? // Shown first, so the line is on the pane above what it prints. Offered, not told: a
					// line a person typed is never dropped, even on a full input.
					fold([{type: "typed", text: msg.value}]).pipe(
						Effect.andThen(offer(started.run, "line", msg.value)),
					)
				: // Ctrl-C. A full `signal` line already holds an interrupt tsh has not read: this one is let go.
					tell(started.run, "signal", "interrupt").pipe(Effect.catchTag("Full", () => Effect.void));
		};
		yield* Queue.take(inbox).pipe(Effect.flatMap(tellOne), Effect.forever, Effect.forkScoped);

		/** Read a message from the page all the way: the envelope, then the run it names, then its input. */
		const read = (raw: unknown): Read<Told> => {
			const envelope = readFromPage(raw);
			if (envelope.kind === "refused") return envelope;
			const {to, msg} = envelope.msg;
			if (to === TSH) {
				const input = readInput(Shell.tsh, msg);
				return input.kind === "read" ? {kind: "read", msg: {to: "tsh", msg: input.msg}} : input;
			}
			const front = fronts.get(to);
			if (front === undefined) return {kind: "refused", why: `no run ${to} is shown here`};
			const input = readInput(front.program, msg);
			return input.kind === "read"
				? {kind: "read", msg: {to: "front", run: front, msg: input.msg}}
				: input;
		};

		const host: Host = {
			show: (next) => {
				page = next;
				draw();
			},
			heard: (raw) => {
				const told = read(raw);
				if (told.kind === "refused") return told;
				Queue.offerUnsafe(inbox, told.msg);
				return {kind: "read"};
			},
		};
		return host;
	});
