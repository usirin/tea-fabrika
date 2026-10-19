import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {defineProgram} from "@tea-fabrika/tea-program";
import {type Entry, listed} from "@tea-fabrika/tea-program/listed";
import {flag, output} from "@tea-fabrika/tea-program/shape";
import {memoryStorage} from "@tea-fabrika/tea-program/storage";
import {Context, Deferred, Effect, Exit, FileSystem, Layer, PubSub, Schema, Scope} from "effect";
import type {Ask, Next, Refused, Settled, Waiting} from "../asks/ask.ts";
import {titleOf} from "../asks/ask.ts";
import {demoEntries} from "../asks/demo.ts";
import {memoryLedger} from "../asks/ledger.ts";
import {
	loadPacks,
	type PackRefused,
	type Platform,
	readerOf,
	startWithPacks,
	type Wired,
} from "../asks/packs.ts";
import {asksProgram} from "../asks/program.ts";
import type {Config} from "./config.ts";

// The owner's desk in tsh: the core (the asks program) started with the packs
// tsh.toml names, kept running for the life of one tsh. The host finds a pack
// that reads typed replies by its `shell` part, never by its name.
//
//   desk                                   what waits on the owner, and where the pages are
//   desk-demo                              the same, started over on a demo ledger
//   answer --ask <id> --reply "<reply>"    a reply, as typed, through the pack that reads it
//
// The ledger is in memory: it lives as long as this tsh. One tsh session (a
// terminal, or one `-c` with several lines) is one desk; a second `bin/tsh`
// starts on an empty ledger. A disk ledger behind the same `Ledger` service
// is its own slice.
//
// The demo is kept apart: its own ledger, made from experiment 89's cases
// (../asks/demo.ts), and its own folder under the tsh home, which each
// `desk-demo` clears first. Its packs get no settings from tsh.toml, so
// nothing it writes lands where a real desk's pages go. In a tsh where the
// demo ran, `desk` and `answer` work on the demo.

/** What the core and the packs said that the host waits on. */
type Heard =
	| {readonly on: "waiting"; readonly asks: readonly Ask[]}
	| {readonly on: "settled"; readonly settled: Settled}
	| {readonly on: "refused"; readonly refused: Refused};

/** A desk that is running: the core and its packs, under a scope of their own. */
interface Running {
	readonly demo: boolean;
	readonly wired: Wired;
	readonly scope: Scope.Closeable;
	/** What waits on the owner, as the core last said it. */
	readonly asks: () => readonly Ask[];
	readonly heard: PubSub.PubSub<Heard>;
	/** Where the pages are, from the pack that reads typed replies; `null`: no pack shows pages. */
	readonly pages: string | null;
}

/** Why a desk line did not do what was asked, in words. */
export interface DeskRefused {
	readonly _tag: "desk_refused";
	readonly message: string;
}
const refusedWith = (message: string): DeskRefused => ({_tag: "desk_refused", message});

const fromPack = (e: PackRefused) => refusedWith(`the pack ${e.name} did not start: ${e.why}`);

export interface DeskSession {
	/** The desk this tsh has open, started on first use. `demo`: start the demo over in its place. */
	readonly open: (demo: boolean) => Effect.Effect<Running, DeskRefused, Platform>;
	/** Close the open desk: the core and each pack read what they were told, then end. */
	readonly close: Effect.Effect<void>;
}

export class Desk extends Context.Service<Desk, DeskSession>()("tsh/Desk") {}

/** The last part of a pack's name: its folder under the tsh home. */
const folderName = (name: string) => name.split("/").at(-1) ?? name;

/** Close every input of a run and wait, up to a limit, for it to end. */
const drain = (running: Wired["core"], limit: string) =>
	Effect.gen(function* () {
		for (const input of Object.keys(running.run.program.inputs)) running.close(input);
		yield* running.run.ended.pipe(Effect.timeout(limit), Effect.ignore);
	});

/**
 * The desk of one tsh. `home`: tsh's home; `folder`: the config's folder,
 * where packs are found and relative paths in their settings are read from;
 * `user`: the user's home, for showing a path from `~`.
 */
export function deskSession(
	config: Config,
	places: {readonly home: string; readonly folder: string; readonly user?: string},
): DeskSession {
	const real = memoryLedger();
	let now: Running | null = null;

	const close = Effect.gen(function* () {
		const was = now;
		now = null;
		if (was === null) return;
		yield* drain(was.wired.core, "2 seconds");
		for (const p of was.wired.packs) yield* drain(p.running, "5 seconds");
		yield* Scope.close(was.scope, Exit.void);
	});

	const begin = (demo: boolean) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const home = demo ? `${places.home}/desk-demo` : `${places.home}/packs`;
			if (demo) yield* fs.remove(home, {recursive: true, force: true}).pipe(Effect.ignore);
			const packs = yield* loadPacks(config.packs, places.folder).pipe(Effect.mapError(fromPack));
			const settings = demo ? {} : config.pack;
			const placesOf = (name: string) => ({
				folder: places.folder,
				home: `${home}/${folderName(name)}`,
			});
			const heard = yield* PubSub.unbounded<Heard>();
			const first = Deferred.makeUnsafe<void>();
			let asks: readonly Ask[] = [];
			const hear = (said: Heard) => {
				if (said.on === "waiting") {
					asks = said.asks;
					Deferred.doneUnsafe(first, Effect.void);
				}
				PubSub.publishUnsafe(heard, said);
			};
			const scope = yield* Scope.make();
			const ledger = demo ? memoryLedger(demoEntries()) : real;
			const wired = yield* startWithPacks(
				{program: asksProgram, flags: {}},
				packs,
				settings,
				memoryStorage(),
				{id: "asks"},
				{
					places: placesOf,
					core: (out, value) => {
						if (out === "waiting") hear({on: "waiting", asks: (value as Waiting).asks});
						if (out === "settled") hear({on: "settled", settled: value as Settled});
						if (out === "refused") hear({on: "refused", refused: value as Refused});
					},
					unread: (refused) => hear({on: "refused", refused}),
				},
			).pipe(
				Effect.provide(ledger.layer),
				Scope.provide(scope),
				Effect.mapError(fromPack),
				Effect.tapError(() => Scope.close(scope, Exit.void)),
			);
			// The core says the whole list at its start.
			yield* Deferred.await(first);
			const reader = readerOf(wired);
			const pages =
				reader === null
					? null
					: reader.pack.shell.pages(
							demo ? {} : (settings[reader.name] ?? {}),
							placesOf(reader.name),
						);
			// Under the user's home it is shown from `~`, short enough for one line.
			const shown =
				pages !== null && places.user !== undefined && pages.startsWith(`${places.user}/`)
					? `~${pages.slice(places.user.length)}`
					: pages;
			return {demo, wired, scope, asks: () => asks, heard, pages: shown} satisfies Running;
		});

	return {
		open: (demo) =>
			Effect.gen(function* () {
				if (now !== null && !demo) return now;
				yield* close;
				now = yield* begin(demo);
				return now;
			}),
		close,
	};
}

/** A text cut to `width`, with `…` when it was longer. Pure. */
const cut = (text: string, width: number) =>
	text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;

/** tsh shows each line of a value cut to this many characters. */
const WIDTH = 100;

/**
 * The desk as lines: what waits on the owner, one line per ask, how to
 * answer each kind, and where the pages are. `replies`: the reading pack's
 * words for an ask, `null` when no pack reads typed replies. Pure.
 */
export function inboxLines(
	asks: readonly Ask[],
	desk: {
		readonly demo: boolean;
		readonly replies: ((ask: Ask) => readonly string[]) | null;
		readonly pages: string | null;
	},
): readonly string[] {
	const idWidth = Math.max(0, ...asks.map((ask) => ask.id.length));
	const rows = asks.map((ask) => {
		const head = `  ${ask.for.padEnd(7)}${ask.id.padEnd(idWidth)}  `;
		return `${head}${cut(titleOf(ask), WIDTH - head.length)}`;
	});
	const kinds = [...new Map(asks.map((ask) => [ask.for, ask])).values()];
	const how =
		asks.length === 0
			? []
			: desk.replies === null
				? ["No pack in tsh.toml reads typed replies, so answer cannot reach the core."]
				: [
						'Answer: answer --ask <id> --reply "<reply>". Replies that fit:',
						...kinds.map((ask) => `  ${ask.for.padEnd(7)}${desk.replies?.(ask).join(" | ")}`),
					];
	return [
		...(desk.demo
			? ["Demo desk: experiment 89's cases, in this tsh's memory only. desk-demo starts it over."]
			: []),
		asks.length === 0
			? "Nothing waits on the owner."
			: `${asks.length} ${asks.length === 1 ? "ask waits" : "asks wait"} on the owner, oldest first:`,
		...rows,
		...how,
		desk.pages === null ? "No pack in tsh.toml shows pages." : `Pages: ${desk.pages}`,
	];
}

/** What the core does next, in words. Pure. */
export function nextInWords(next: Next): string {
	switch (next.do) {
		case "build":
			return `approved: version ${next.version} goes to build`;
		case "replan":
			return `the planner writes the next version with ${next.line} changed`;
		case "close":
			return `said no: the plan's tickets close (${next.why})`;
		case "remove_task":
			return `task ${next.task} leaves the plan`;
		case "keep_going":
			return `task ${next.task} goes on for at most ${next.rounds} more review rounds`;
		case "reopen":
			return `criterion ${next.criterion} of task ${next.task} is said again, and open`;
		case "ruled":
			return `ruled${next.record ? ", and written as a decision record" : ""}${next.plan ? ", and a plan will be made to build it" : ""}`;
		case "ship":
			return `build ${next.build} of task ${next.task} ships`;
		case "rebuild":
			return `the note is a new criterion of task ${next.task}, and it goes back to build`;
	}
}

const linesOf = (running: Running) =>
	inboxLines(running.asks(), {
		demo: running.demo,
		replies: readerOf(running.wired)?.pack.shell.replies ?? null,
		pages: running.pages,
	});

const Line = output(Schema.String, "One line of the desk.");
/** Send each line on `line`, one after another: a desk is read top to bottom. */
const sendAll =
	<E, R>(send: (output: "line", value: string) => Effect.Effect<void, E, R>) =>
	(lines: readonly string[]) =>
		Effect.forEach(lines, (l) => send("line", l), {concurrency: 1, discard: true});

const showDesk = (demo: boolean) =>
	Effect.gen(function* () {
		const desk = yield* Desk;
		return linesOf(yield* desk.open(demo));
	});

export const deskProgram = defineProgram({
	name: "desk",
	description:
		"The owner's desk: starts the core with the packs tsh.toml names, if this tsh has not, and prints what waits on the owner, one line per ask, how to answer each kind, and where the pages are.",
	inputs: {},
	outputs: {line: Line},
	main: ({send}) => showDesk(false).pipe(Effect.flatMap(sendAll(send))),
});

export const deskDemoProgram = defineProgram({
	name: "desk-demo",
	description:
		"The owner's desk on a demo ledger: experiment 89's real cases (six plans, one changed after approval, a stuck task, four rulings), in memory only, with pages in their own folder under the tsh home. Starts the demo over each time.",
	inputs: {},
	outputs: {line: Line},
	main: ({send}) => showDesk(true).pipe(Effect.flatMap(sendAll(send))),
});

/** One typed reply through the reading pack: the answer the core took, or why it was refused. */
const reply = (running: Running, id: string, text: string) =>
	Effect.gen(function* () {
		const reader = readerOf(running.wired);
		if (reader === null)
			return yield* Effect.fail(
				refusedWith("no pack in tsh.toml reads typed replies: add one to its packs line"),
			);
		const ask = running.asks().find((a) => a.id === id);
		if (ask === undefined)
			return yield* Effect.fail(
				refusedWith(`nothing waits on the owner under ${id}: desk lists what does`),
			);
		const fits = `Replies that fit a ${ask.for} ask: ${reader.pack.shell.replies(ask).join(" | ")}`;
		const said = yield* PubSub.subscribe(running.heard);
		/** The next thing heard that `test` takes. */
		const next = (test: (h: Heard) => boolean) =>
			Effect.gen(function* () {
				for (;;) {
					const h = yield* PubSub.take(said);
					if (test(h)) return h;
				}
			});
		reader.running.run.tell(reader.pack.shell.typed, {id: ask.id, text});
		const heard = yield* next(
			(h) =>
				(h.on === "settled" && h.settled.ask.id === ask.id) ||
				(h.on === "refused" && h.refused.id === ask.id),
		);
		if (heard.on === "refused")
			return yield* Effect.fail(refusedWith(`${heard.refused.why}. ${fits}`));
		if (heard.on !== "settled") return yield* Effect.die(new Error("not an outcome"));
		// The core says the shorter list right after it takes the answer.
		if (running.asks().some((a) => a.id === ask.id))
			yield* next((h) => h.on === "waiting" && !h.asks.some((a) => a.id === ask.id));
		return heard.settled;
	}).pipe(
		Effect.scoped,
		Effect.timeoutOrElse({
			duration: "10 seconds",
			onTimeout: () => Effect.fail(refusedWith("the desk did not answer in 10 seconds")),
		}),
	);

export const answerProgram = defineProgram({
	name: "answer",
	description:
		"Hands the owner's reply to one ask, as typed, to the core through the pack that reads typed replies, and prints what the core does next and the desk after it. A reply that does not fit is refused, naming the replies that do.",
	flags: {
		ask: flag(Schema.String, "The id of the ask, as desk prints it."),
		reply: flag(Schema.String, 'The reply, as on the ask\'s page; the "/" may be left out.'),
	},
	inputs: {},
	outputs: {line: Line},
	main: ({flags, send}) =>
		Effect.gen(function* () {
			const desk = yield* Desk;
			const running = yield* desk.open(false);
			const settled = yield* reply(running, flags.ask, flags.reply);
			const lines = [
				`Taken: ${settled.ask.id}: ${nextInWords(settled.next)}.`,
				...linesOf(running),
			];
			yield* sendAll(send)(lines);
		}),
});

/** desk, desk-demo and answer, each handed this tsh's one desk and the platform services. */
export function deskEntries(session: DeskSession): readonly Entry[] {
	const services = Layer.mergeAll(Layer.succeed(Desk, session), nodeServices);
	return [
		listed(deskProgram, services),
		listed(deskDemoProgram, services),
		listed(answerProgram, services),
	];
}
