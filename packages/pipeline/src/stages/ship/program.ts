import {
	type Delivery,
	defineProgram,
	flag,
	input,
	kind,
	output,
	type RefsOf,
	type Send,
} from "@kampus/fabrika";
import {Effect, Exit, Schema, Stream} from "effect";
import {nameOf} from "../outcome.ts";
import {drop, queueKind, workQueue} from "../queue.ts";
import {shipLine} from "../status.ts";
import {prName, shipDrawing} from "../traced.ts";
import {shipReadInterpret, shipSubscribe, shipWriteInterpret} from "./handlers.ts";
import {Look, look} from "./look.ts";
import {Ship, ship} from "./machine.ts";
import {SHIP_NAMES, ShipOutcome} from "./outcome.ts";

// The ship program: the thing you start to ship pull requests. It is started
// once, with its mode as a flag, and then told pull requests for as long as it
// runs, one after another, the way `review | ship` would feed it. Each pull
// request gets a run of the ship machine (./machine.ts) of its own: the
// machine takes one pull request from start to end, so the program, not the
// machine, is what keeps running. They go one at a time, never side by side:
// two enqueues on one base branch would race. When its starter closes `pr`
// (or the programs piped into it end), it finishes every pull request already
// told there, and ends.
//
// Two ways in. `pr` takes a pull request, in one of two forms: a bare url, as
// a person tells it, or a pull request at the head a review passed (`Passed`),
// as `review | ship` gives it. `ask` takes one with an id the asker picked,
// and the answer comes back on `answer` under that id: Elm's request and its
// answer Msg, over a pipe.
//
// A pull request at a head carries its own id, the url of that commit of it:
// an idempotency key, as Stripe's `Idempotency-Key` header is one. The same
// head told again is the same work, whenever it comes: once its run is over,
// it is answered again from what was kept, and nothing is sent to GitHub
// twice. A new head on the same pull request is a new id, so new work. This is
// what stops a review that said `passed` again after a restart from shipping
// twice (experiment 75c): ship's own record does it, not GitHub saying
// "merged". A bare url carries no head, so it has no such id: told again after
// its run ended, it is new work, as a person telling it twice means it.
//
//   read   read, gate, say what it would send. The machine is stepped as far
//          as its first write or wait (./look.ts), and nothing is sent.
//   write  the machine runs to its end on tea's Effect engine, with the
//          handlers that write and the two Listens. Its state shows on the
//          run's handle as the machine `ship`, the newest run's.
//
// In write mode each machine run keeps its state in the run's storage, under
// its ask's id (a fresh one for a bare `pr`). So a run started again with the
// same id and storage, after a crash, does two things a fresh one cannot:
//
//   - it first takes each machine run it left unfinished to its end, from
//     where it stood: a pull request in the merge queue is not queued twice,
//     and a re-run of red checks already made is not made again;
//   - an ask under an id it has already answered is answered again from what
//     was kept, and the machine does not run a second time. An asker that
//     crashed before it heard the answer asks again and hears it, and nothing
//     on GitHub happens twice.
//
// How long each is kept: an asked run until its asker tells `forget` under
// its id (it has the answer in its own saved state), or the whole run is
// removed; never by time, since a dropped answer asked again would run the
// machine again. A run at a head is kept the same way, until `forget` under
// its id or the whole run is removed: its sender cannot say when it will not
// send it again (`pr` acks once kept, which ends the outbox's re-sends, but a
// sender killed before it kept its own work done does that work again and
// sends anew), so no shorter time is safe. A bare run,
// which nobody can ask about again, is dropped once it is over.
//
// It asks for `CodeHost` and `CodeHostWrites` through Effect's context and
// makes no connection itself. Whoever starts it provides them: GitHub for
// `run.ts` (./launch.ts), fakes for a test. A read-mode run never asks for
// `CodeHostWrites`; the launcher gives it one that cannot write all the same.

/** A pull request's address. The same pattern the command line took before it was a program. */
export const PullRequestUrl = Schema.String.check(
	Schema.isPattern(/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/, {
		message:
			"not a pull request url: it looks like https://github.com/<owner>/<repo>/pull/<number>",
	}),
).annotate({description: "https://github.com/<owner>/<repo>/pull/<number>"});

/** One whole commit: forty hex digits. A short one could name two. */
export const Commit = Schema.String.check(
	Schema.isPattern(/^[0-9a-f]{40}$/, {message: "not a whole commit: it is forty hex digits"}),
).annotate({description: "a whole commit, forty hex digits"});

/**
 * A pull request at the head a review passed: what review's `passed` sends
 * and ship's `pr` takes. It cannot be made without its head, so what flows
 * down `review | ship` always carries its id (see {@link keyOf}).
 */
export const Passed = Schema.Struct({pr: PullRequestUrl, head: Commit});
export type Passed = typeof Passed.Type;

/**
 * The id a pull request at a head is shipped under, once: the url of that
 * commit of it. Its idempotency key: the same head told again is the same
 * work; a new head is new work.
 */
export const keyOf = ({pr, head}: Passed): string => `pr/${pr}/commits/${head}`;

/** What `pr` takes: a bare url, as a person tells it, or a pull request at a reviewed head, as a pipe gives it. */
const Told = Schema.Union([PullRequestUrl, Passed]);

/** How one pull request ended, in write mode. `name`: how the outcome is spelled, beside the data it is made from. */
export const Shipped = Schema.Struct({
	pr: Schema.String,
	outcome: ShipOutcome,
	name: Schema.Literals(SHIP_NAMES),
});
export type Shipped = typeof Shipped.Type;

/** One ask: a pull request, and the id its answer comes back under. The asker picks the id and asks again under it after a restart. */
export const Ask = Schema.Struct({id: Schema.String, pr: PullRequestUrl});
export type Ask = typeof Ask.Type;

/** The answer to one ask: how its pull request ended, under the ask's id. */
export const Answer = Schema.Struct({
	id: Schema.String,
	pr: Schema.String,
	outcome: ShipOutcome,
	name: Schema.Literals(SHIP_NAMES),
});
export type Answer = typeof Answer.Type;

/** An asker that has the answer to its ask in its own saved state: what ship kept to answer it again may go. */
export const Forget = Schema.Struct({id: Schema.String});
export type Forget = typeof Forget.Type;

/** The pull request a kept run is on. `null`: it never started. */
const prOf = (s: Ship): string | null => (s.phase === "idle" ? null : s.pr);

/**
 * The ship machine as a kind. Found mid-way, it sends again what was in
 * flight, and its Listens open after; kept before it began, it starts from
 * the caller's Msg. A run alone holds no working copy, so the tidy-up has
 * nothing of its own to remove.
 */
export const shipKind = (machine = ship) =>
	kind({
		machine,
		state: Ship,
		parent: "main",
		options: () => ({
			ctx: undefined,
			interpret: {...shipReadInterpret, ...shipWriteInterpret()},
			subscribe: shipSubscribe,
			terminal: (s: Ship) => s.phase === "over",
		}),
		recovered: (s) => (s.phase === "idle" ? null : {type: "resume"}),
		drawing: ({id, kept, start}) => {
			const pr = (kept === null ? null : prOf(kept)) ?? (start?.type === "start" ? start.pr : id);
			return shipDrawing(prName(pr), pr);
		},
		// One line per pull request: `#8: in the merge queue`, `#8: merged`.
		status: shipLine,
	});

/**
 * One pull request on ship's kept queue, as JSON: the id its run is kept
 * under, and whether that run is kept once it is over. An asked run and a run
 * at a head are kept, until a `forget` under their id: the first so its asker
 * can ask again, the second so a repeat of it is caught by its id. A bare one
 * is dropped once it is over.
 */
const Item = Schema.Struct({id: Schema.String, pr: Schema.String, kept: Schema.Boolean});
type Item = typeof Item.Type;
const ItemJson = Schema.fromJsonString(Item);
const itemOf = Schema.decodeUnknownEffect(ItemJson);
const readItem = Schema.decodeUnknownExit(ItemJson);
const textOf = Schema.encodeSync(ItemJson);

/**
 * The machine to its end, under `id`, with the handlers that write and the
 * two Listens, shown on the handle while it runs. A run found kept goes on
 * from where it stood; one kept over is answered from what was kept, and
 * nothing runs again.
 */
const toTheEnd = (ships: RefsOf<ReturnType<typeof shipKind>>, id: string, pr: string) =>
	Effect.gen(function* () {
		const runtime = yield* ships.get(id).start({type: "start", pr});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the run stopped in ${end.phase}`);
		return end;
	}).pipe(Effect.scoped);

const OUTPUTS = {
	found: output(
		Look,
		"Read mode, once per pull request: the facts read, the machine's answer, and the write it would send next. Nothing was sent.",
	),
	outcome: output(Shipped, "Write mode, once per pull request: how it ended."),
	answer: output(
		Answer,
		"Write mode, once per ask, and again for each ask again: how its pull request ended, under the ask's id.",
	),
	forgot: output(
		Forget,
		"Write mode, once per forget: what was kept under that id is gone, and the drop is kept.",
	),
};

/** One machine run to its end, and both words about it. */
const shipped = (
	ships: RefsOf<ReturnType<typeof shipKind>>,
	item: Item,
	send: Send<typeof OUTPUTS>,
) =>
	toTheEnd(ships, item.id, item.pr).pipe(
		Effect.flatMap(({outcome}) => {
			const said = {pr: item.pr, outcome, name: nameOf(outcome)};
			return send("outcome", said).pipe(Effect.andThen(send("answer", {id: item.id, ...said})));
		}),
	);

/**
 * The ship program over a given ship machine. `machine`: one with other
 * limits, for a test.
 */
export const createShipProgram = (machine = ship) =>
	defineProgram({
		name: "ship",
		description:
			"Puts pull requests in the merge queue, or merges them when the repository has no queue, one after another, as it is told them, and says how each one ended. In read mode it changes nothing, and says what it would do.",
		flags: {
			mode: flag(
				Schema.Literals(["read", "write"]),
				"read: change nothing, say what the machine would send. write: run it to its end; it may put each pull request in the merge queue, or merge it where there is no queue, and start its red checks again.",
			),
		},
		inputs: {
			pr: input(
				Told,
				"A pull request to ship, told any time. A bare url ships each time it is told. One at a head (review's `passed`) ships once at that head: told again, it is answered from what was kept; a new head is new work. Acked once kept.",
				{ack: "manual"},
			),
			ask: input(
				Ask,
				"A pull request to ship, with the id its answer comes back under on `answer`. Asked again under an id already answered, it answers again from what it kept, and ships nothing twice.",
			),
			forget: input(
				Forget,
				"An id whose answer the asker now keeps itself: what ship kept to answer that ask again is dropped. Tell it once the answer is in the asker's own saved state. Until then the answer is kept, however long.",
			),
		},
		outputs: OUTPUTS,
		machines: {queue: queueKind, ship: shipKind(machine)},
		main: ({flags, inputs, send, machines}) => {
			// `pr` is the run's lifeline, as stdin is: when it closes, the run finishes what it holds and ends,
			// and an ask not yet read goes unanswered. Its asker hears the run end.
			const told: Stream.Stream<Delivery<Item>> = Stream.merge(
				// A bare pull request has no id to catch a repeat by, so its run is dropped once it is over.
				// One at a head is kept under the url of that commit, so the same head told again is caught.
				inputs.pr.pipe(
					Stream.map(
						({value, ack}): Delivery<Item> => ({
							value:
								typeof value === "string"
									? {id: `pr/${value}`, pr: value, kept: false}
									: {id: keyOf(value), pr: value.pr, kept: true},
							ack,
						}),
					),
				),
				// An ask is told by its asker, who asks again under its id: it waits on no ack.
				inputs.ask.pipe(
					Stream.map(
						({id, pr}): Delivery<Item> => ({value: {id, pr, kept: true}, ack: Effect.void}),
					),
				),
				{haltStrategy: "left"},
			);
			// Read mode keeps nothing, so it has nothing to forget, and a value is taken once read.
			if (flags.mode === "read")
				return told.pipe(
					Stream.runForEach(({value, ack}) =>
						ack.pipe(
							Effect.andThen(look(value.pr)),
							Effect.flatMap((found) => send("found", found)),
						),
					),
				);

			// Each pull request goes on the kept queue first, so a start after a kill carries every one
			// told and not finished, in order (../queue.ts). An ask again under an id already answered
			// starts a run kept over: it is answered from what was kept, and nothing ships twice.
			const working = workQueue(
				machines.queue,
				told.pipe(Stream.map(({value, ack}) => ({value: textOf(value), ack}))),
				(text) =>
					itemOf(text).pipe(
						Effect.orDie,
						Effect.flatMap((item) => shipped(machines.ship, item, send)),
					),
				(text) =>
					itemOf(text).pipe(
						Effect.orDie,
						Effect.flatMap((item) => (item.kept ? Effect.void : machines.ship.get(item.id).clear)),
					),
			);
			// A forget is done beside the queue, not after it: an asker waits on its `forgot`, and must not
			// wait behind another asker's pull request in the merge queue. Only an answered ask is forgotten,
			// so no run still going is dropped. An answered ask a kill left on the queue is taken off it
			// first, so its work does not start again on the run dropped under it. The queue's end is the run's.
			const forgotten = inputs.forget.pipe(
				Stream.runForEach(({id}) =>
					drop(machines.queue, (text) => {
						const item = readItem(text);
						return Exit.isSuccess(item) && item.value.kept && item.value.id === id;
					}).pipe(
						Effect.andThen(machines.ship.get(id).clear),
						Effect.andThen(send("forgot", {id})),
					),
				),
			);
			return working.pipe(Effect.raceFirst(forgotten.pipe(Effect.andThen(Effect.never))));
		},
	});

/** The ship program, on a ship machine with every setting at its default. */
export const shipProgram = createShipProgram();
