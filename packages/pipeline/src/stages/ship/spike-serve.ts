import {type Delivery, flag, output, type RefsOf, type Send} from "@kampus/fabrika";
import * as Program from "@kampus/fabrika/spike/serve";
import {type Cause, Deferred, Effect, Exit, Fiber, Queue, Schema, Stream} from "effect";
import {nameOf} from "../outcome.ts";
import {drop, queueKind, workQueue} from "../queue.ts";
import {Look, look} from "./look.ts";
import {ship} from "./machine.ts";
import {Answer, Ask, Forget, keyOf, Passed, PullRequestUrl, Shipped, shipKind} from "./program.ts";

// Experiment 164's spike: the ship program (./program.ts) on one mailbox. The
// same machines, the same kept queue and the same work per pull request. What
// changes is how `pr`, `ask` and `forget` are read: one handler each, served
// in the order told, until `pr` closes. The kept queue's worker starts in
// setup; a `pr` or an `ask` handler only puts its item on it, so no handler
// is slow, and `forget` needs no fork: it never waits behind another pull
// request's work, only behind other puts. `Item`, its codecs and `shipped`
// are copied from ./program.ts unchanged.

const Told = Schema.Union([PullRequestUrl, Passed]);
const Item = Schema.Struct({id: Schema.String, pr: Schema.String, kept: Schema.Boolean});
type Item = typeof Item.Type;
const ItemJson = Schema.fromJsonString(Item);
const itemOf = Schema.decodeUnknownEffect(ItemJson);
const readItem = Schema.decodeUnknownExit(ItemJson);
const textOf = Schema.encodeSync(ItemJson);

/** A pull request as `pr` takes it, as an item of the kept queue. */
const itemOfPr = (value: typeof Told.Type): Item =>
	typeof value === "string"
		? {id: `pr/${value}`, pr: value, kept: false}
		: {id: keyOf(value), pr: value.pr, kept: true};

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

const toTheEnd = (ships: RefsOf<ReturnType<typeof shipKind>>, id: string, pr: string) =>
	Effect.gen(function* () {
		const runtime = yield* ships.get(id).start({type: "start", pr});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the run stopped in ${end.phase}`);
		return end;
	}).pipe(Effect.scoped);

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
 * `workQueue` split in two, for a handler table: its worker starts now, and
 * `told` hands it one value and returns once the kept queue has it (its ack
 * has run). `drained`: no more values; wait until every one is worked.
 */
const startQueue = <E1, R1, E2, R2>(
	queues: RefsOf<typeof queueKind>,
	work: (item: string) => Effect.Effect<void, E1, R1>,
	after: (item: string) => Effect.Effect<void, E2, R2>,
) =>
	Effect.gen(function* () {
		const line = yield* Queue.unbounded<Delivery<string>, Cause.Done>();
		const worker = yield* Effect.forkScoped(workQueue(queues, Stream.fromQueue(line), work, after));
		const told = ({value, ack}: Delivery<string>) =>
			Effect.gen(function* () {
				const kept = yield* Deferred.make<void>();
				yield* Queue.offer(line, {
					value,
					ack: ack.pipe(Effect.andThen(Deferred.succeed(kept, undefined))),
				});
				yield* Deferred.await(kept);
			});
		return {told, drained: Queue.end(line).pipe(Effect.andThen(Fiber.join(worker)))};
	});

export const createSpikeShip = (machine = ship) =>
	Program.make("ship", {
		description:
			"Puts pull requests in the merge queue, or merges them when the repository has no queue, one after another, as it is told them, and says how each one ended. In read mode it changes nothing, and says what it would do.",
		flags: {
			mode: flag(
				Schema.Literals(["read", "write"]),
				"read: change nothing, say what the machine would send. write: run it to its end; it may put each pull request in the merge queue, or merge it where there is no queue, and start its red checks again.",
			),
		},
		inputs: {
			pr: Program.input(
				Told,
				"A pull request to ship, told any time. A bare url ships each time it is told. One at a head (review's `passed`) ships once at that head: told again, it is answered from what was kept; a new head is new work. Acked once kept.",
				{ack: "manual"},
			),
			ask: Program.input(
				Ask,
				"A pull request to ship, with the id its answer comes back under on `answer`. Asked again under an id already answered, it answers again from what it kept, and ships nothing twice.",
			),
			forget: Program.input(
				Forget,
				"An id whose answer the asker now keeps itself: what ship kept to answer that ask again is dropped. Tell it once the answer is in the asker's own saved state. Until then the answer is kept, however long.",
			),
		},
		outputs: OUTPUTS,
		machines: {queue: queueKind, ship: shipKind(machine)},
		main: ({flags, serve, send, machines}) =>
			Effect.gen(function* () {
				// `pr` is the run's lifeline, as stdin is: once it closes, what was told before it is served.
				if (flags.mode === "read")
					return yield* serve(
						{
							pr: ({value, ack}) =>
								ack.pipe(
									Effect.andThen(look(itemOfPr(value).pr)),
									Effect.flatMap((found) => send("found", found)),
								),
							ask: ({pr}) => look(pr).pipe(Effect.flatMap((found) => send("found", found))),
							// Read mode keeps nothing, so it has nothing to forget.
							forget: () => Effect.void,
						},
						{until: ["pr"]},
					);

				const queue = yield* startQueue(
					machines.queue,
					(text) =>
						itemOf(text).pipe(
							Effect.orDie,
							Effect.flatMap((item) => shipped(machines.ship, item, send)),
						),
					(text) =>
						itemOf(text).pipe(
							Effect.orDie,
							Effect.flatMap((item) =>
								item.kept ? Effect.void : machines.ship.get(item.id).clear,
							),
						),
				);
				yield* serve(
					{
						pr: ({value, ack}) => queue.told({value: textOf(itemOfPr(value)), ack}),
						// An ask is told by its asker, who asks again under its id: it waits on no ack.
						ask: ({id, pr}) => queue.told({value: textOf({id, pr, kept: true}), ack: Effect.void}),
						// In order: after an ask told before it, never before. Its handler waits only on
						// other puts, never on another pull request's merge.
						forget: ({id}) =>
							drop(machines.queue, (text) => {
								const item = readItem(text);
								return Exit.isSuccess(item) && item.value.kept && item.value.id === id;
							}).pipe(
								Effect.andThen(machines.ship.get(id).clear),
								Effect.andThen(send("forgot", {id})),
							),
					},
					{until: ["pr"]},
				);
				// What was told before `pr` closed still ships.
				yield* queue.drained;
			}).pipe(Effect.scoped),
	});

export const spikeShip = createSpikeShip();
