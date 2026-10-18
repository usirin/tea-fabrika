import {run} from "@demlik/tea/effect";
import {memoryStore} from "@demlik/tea/mem";
import {Effect, Layer, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {CodeHost, CodeHostWrites} from "../../wip/src/services";
import type {Rerun, ShipFacts} from "../../wip/src/stages/ship/facts";
import type {ShipOutcome} from "../../wip/src/stages/ship/outcome";
import {type FakeScript, fakeFabrika} from "./fabrika-scripted";
import {
	createOperator,
	defaultKnobs,
	type Knobs,
	type Operator,
	type OperatorMsg,
	updateWith,
} from "./operator";
import {
	fieldRows,
	operatorInterpret,
	operatorShipInterpret,
	operatorShipSubscribe,
	operatorSubscribe,
} from "./operator-host";
import {scriptedJev} from "./scripted";
import {shipLine} from "./turn";

// The operator with its ship stage filled by the ship machine, driven end to
// end on the Effect engine against fabrika in memory and a scripted code
// host. No agent ships anything here, no CLI runs, and nothing reaches
// GitHub. The builder and the reviewer are still scripted shells.

const PR = "https://github.com/example/repo/pull/7";
const OWNER = "owner";
const TREE = "42-r1";
const HEAD = "abc1234";
/** The commit the merge queue makes on the base branch. */
const MERGE = "m3rg3c0";
const knobs: Knobs = {
	...defaultKnobs,
	slots: 2,
	recheckMs: 2,
	rechecks: 3,
	queueStallMs: 5_000,
	ciWaitMs: 5_000,
	msPerMinute: 1_000,
	who: [OWNER],
};
const say = (token: string) => ({token, pr: PR});
const NO_SHELLS = {
	trees: "",
	plugin: "",
	alsoWritable: [],
	model: "",
	effort: "medium",
	maxShellUsd: 0,
} as const;

/** A pull request with nothing in its way. */
const clear: ShipFacts = {
	head: HEAD,
	state: "open",
	ours: true,
	ticket: "closes_it",
	approval: "not_needed",
	reviews: "passed",
	reviewKinds: [],
	checks: "green",
	mergeable: "clean",
	comments: [],
};
const facts = (patch: Partial<ShipFacts> = {}): ShipFacts => ({...clear, ...patch});

/** The lane up to the ship stage: a build that opens the pull request, and a review that passes. */
const toShip = [
	{shell: "builder", reports: "DONE", says: say("SHIPPED-PR"), opens: PR},
	{shell: "reviewer", reports: "PASS", says: say("PASS")},
] as const;

interface World {
	/** Each read's answer, in order. */
	readonly facts: readonly ShipFacts[];
	readonly rerun?: readonly Rerun[][];
	readonly enqueue?: readonly ("queued" | "head_moved" | "conflicts")[];
	/** How the pull request leaves the queue. `never`: the queue says nothing. It can be changed while a run stands. */
	queue?: "landed" | "ejected" | "never";
}

/** The code host, scripted, with every call kept. A call no script names fails the test. */
function codeHost(world: World) {
	const reads = [...world.facts];
	const reruns = [...(world.rerun ?? [])];
	const enqueues = [...(world.enqueue ?? [])];
	const calls = {
		read: 0,
		reran: [] as string[],
		enqueued: [] as string[],
		waitedOn: [] as string[],
		listened: [] as string[],
	};
	const next = <A>(answers: A[], what: string): A => {
		const answer = answers.shift();
		if (answer === undefined) throw new Error(`${what} came, and no script names it`);
		return answer;
	};
	const layer = Layer.mergeAll(
		Layer.succeed(CodeHost, {
			prFacts: () =>
				Effect.sync(() => {
					calls.read += 1;
					return next(reads, "a read of the facts");
				}),
			change: () => Effect.fail({_tag: "unknown" as const}),
			checksSettled: (_pr, head) => {
				calls.waitedOn.push(head);
				return Stream.make(undefined);
			},
			leftQueue: (_pr, head) => {
				calls.listened.push(head);
				const how = world.queue ?? "landed";
				return how === "never"
					? Stream.never
					: Stream.make(
							how === "landed"
								? {reading: "landed" as const, commit: MERGE}
								: {reading: "ejected" as const},
						);
			},
		}),
		Layer.succeed(CodeHostWrites, {
			enqueue: (_pr, head) =>
				Effect.sync(() => {
					calls.enqueued.push(head);
					return next(enqueues, "an enqueue");
				}),
			rerunChecks: (_pr, head) =>
				Effect.sync(() => {
					calls.reran.push(head);
					return next(reruns, "a re-run");
				}),
		}),
	);
	return {layer, calls};
}

type Fake = ReturnType<typeof fakeFabrika>;
type Host = ReturnType<typeof codeHost>;

/** Run the operator, its ship stage filled by the ship machine, until `until` holds. */
function runOn(
	fake: Fake,
	host: Host,
	first: OperatorMsg,
	o: {until?: (s: Operator) => boolean; store?: ReturnType<typeof memoryStore<Operator>>} = {},
) {
	const program = Effect.gen(function* () {
		const handle = yield* run(createOperator(2, {ship: "machine"}), {
			ctx: undefined,
			interpret: operatorShipInterpret("jev-test"),
			// The builder and the reviewer are scripted shells. A shipper shell has no script, so one that started would fail the test.
			subscribe: {
				...operatorSubscribe({pollMs: 1, shell: NO_SHELLS}),
				shell: fake.shellRunner,
				...operatorShipSubscribe,
			},
			terminal: o.until ?? ((s) => s.phase === "ended"),
			...(o.store === undefined ? {} : {store: o.store}),
		});
		const runtime = yield* handle.ready;
		yield* runtime.dispatch(first);
		return yield* runtime.done().pipe(Effect.timeout("4 seconds"));
	});
	const services = Layer.mergeAll(fake.layer, fake.thread, scriptedJev([] as never), host.layer);
	return Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(services)));
}

async function drive(
	script: Omit<FakeScript, "lane">,
	world: World,
	o: {knobs?: Knobs; until?: (s: Operator, fake: Fake) => boolean} = {},
) {
	const fake = fakeFabrika({lane: "42", ...script});
	const host = codeHost(world);
	const {until} = o;
	const end = await runOn(
		fake,
		host,
		{type: "start", run: "r1", lane: "42", knobs: o.knobs ?? knobs},
		until === undefined ? {} : {until: (s) => until(s, fake)},
	);
	const ships = "log" in end ? (end.log.ships ?? []) : [];
	return {
		end,
		fake,
		calls: host.calls,
		writes: fake.writes.map((w) => w.what),
		ships,
		names: ships.map((row) => row.name),
	};
}
/** A builder that never ends: where a test stops once the lane is back at the build. */
const builderWaits = [{shell: "builder", reports: null, says: null, ends: "hangs"}] as const;
/** The ship machine's line is written, the lane went back to the build, and a builder is at work there. */
const backAtBuild = (s: Operator, fake: Fake) =>
	fake.lane.state === "build" &&
	s.phase === "driving" &&
	s.turns.issue?.state.phase === "drafting" &&
	(s.log.ships?.length ?? 0) > 0;

describe("the operator hands the ship stage to the ship machine", () => {
	it("takes an issue straight through: a build, a review that passes, and the ship machine lands it", async () => {
		const {end, fake, calls, writes, ships} = await drive(
			{shells: toShip},
			{facts: [clear], enqueue: ["queued"]},
		);

		expect(end).toMatchObject({phase: "ended", end: {kind: "terminal", status: "done"}});
		expect(fake.lane.state).toBe("shipped");
		// No shipper shell: two shells ran, and the ship stage was code.
		expect(fake.dispatched).toEqual(["builder", "reviewer"]);
		expect(calls).toEqual({read: 1, reran: [], enqueued: [HEAD], waitedOn: [], listened: [HEAD]});
		// One line on the lane at the end of the ship, where a shipper's own report would be.
		expect(writes).toEqual([
			"claim",
			"make tree",
			"record started",
			"dispatched builder",
			"dispatched reviewer",
			"record token",
			"finish",
			"remove tree",
			"release",
		]);
		expect(ships).toEqual([
			{
				task: "issue",
				state: "ship",
				pr: PR,
				phases: ["reading", "enqueueing", "queued", "finishing", "over"],
				name: "done",
				outcome: {kind: "done", part: false, commit: MERGE, cleanup: "done"},
			},
		]);
	});

	it("the working copy is the operator's: made once, removed once, and the child's tidy-up leaves it alone", async () => {
		const {fake, writes} = await drive({shells: toShip}, {facts: [clear], enqueue: ["queued"]});

		expect(fake.trees.made).toEqual([TREE]);
		expect(fake.trees.removed).toEqual([TREE]);
		expect(fake.trees.standing.size).toBe(0);
		expect(writes.filter((w) => w === "remove tree")).toHaveLength(1);
	});

	it("a part landing is written as a landing, and fabrika sends the lane round again", async () => {
		const {fake, names, writes} = await drive(
			{state: "ship", pr: PR, partial: true, shells: builderWaits},
			{facts: [facts({ticket: "part_of_it"})], enqueue: ["queued"]},
			{until: backAtBuild},
		);

		expect(names).toEqual(["done:part"]);
		// The landing's line, then what today's operator does with a lane back at `queued`: it starts the build again.
		expect(writes.slice(2)).toEqual(["record token", "record started", "dispatched builder"]);
		expect(fake.lane.state).toBe("build");
	});

	it("red checks: the machine runs them again once itself, and only then sends the work back to the builder", async () => {
		const {fake, calls, ships, writes} = await drive(
			{state: "ship", pr: PR, shells: builderWaits},
			{facts: [facts({checks: "red"}), facts({checks: "red"})], rerun: [[{run: 11, attempt: 1}]]},
			{until: backAtBuild},
		);

		expect(ships[0]).toMatchObject({
			name: "send:builder:checks_red",
			phases: ["reading", "rerunning", "waiting", "reading", "over"],
		});
		expect(calls).toMatchObject({read: 2, reran: [HEAD], waitedOn: [HEAD], enqueued: []});
		// A repair round, as a shipper's "routed to repair" is. Then the builder is started, as after any failed stage.
		expect(writes.slice(2)).toEqual(["record token", "dispatched builder"]);
		expect(fake.lane.state).toBe("build");
	});

	it("a conflict with the base goes back to the builder as a lap that costs no repair round", async () => {
		const {fake, names, writes, calls} = await drive(
			{state: "ship", pr: PR, shells: builderWaits},
			{facts: [facts({mergeable: "conflicts"})]},
			{until: backAtBuild},
		);

		expect(names).toEqual(["send:builder:conflicts"]);
		// The fact today's operator writes for a base conflict, not a failed stage.
		expect(writes.slice(2)).toEqual(["record base_conflicted", "dispatched builder"]);
		expect(fake.lane.state).toBe("build");
		expect(calls.enqueued).toEqual([]);
	});

	it("a pull request thrown out of the merge queue goes back to the builder", async () => {
		const {fake, names} = await drive(
			{state: "ship", pr: PR, shells: builderWaits},
			{facts: [clear], enqueue: ["queued"], queue: "ejected"},
			{until: backAtBuild},
		);

		expect(names).toEqual(["send:builder:ejected"]);
		expect(fake.lane.state).toBe("build");
	});

	it("a review that is missing at the head parks the lane on the verdict it is owed, as today's fabrika does", async () => {
		const {end, fake, names} = await drive(
			{state: "ship", pr: PR},
			{facts: [facts({reviews: "missing"})]},
			{knobs: {...knobs, askWaitMs: 20}},
		);

		expect(names).toEqual(["send:reviewer:no_review"]);
		expect(fake.lane).toMatchObject({state: "blocked", cause: "verdict-owed"});
		// Fabrika 0.9.0 has no way from ship back to review: the park is asked about, and nobody answers here.
		expect(fake.asked).toHaveLength(1);
		expect(end).toMatchObject({phase: "ended", end: {kind: "parked"}});
	});

	it("an owner's approval that is missing: the same park and question as a shipper's, cleared by the recipe once the approval is there", async () => {
		const {end, fake, names, calls, writes} = await drive(
			{state: "ship", pr: PR, unpark: ["not_yet", "cleared"]},
			{facts: [facts({approval: "missing"}), clear], enqueue: ["queued"]},
		);

		// The child asked; the operator's own stop-and-ask path took it from there; the child ran again and landed it.
		expect(names).toEqual(["ask:owner:approval", "done"]);
		expect(fake.asked).toHaveLength(1);
		expect(fake.asked[0]?.text).toContain(
			"stopped at `human:cp-approval` (`awaiting-cp-approval`)",
		);
		expect(fake.asked[0]?.text).toContain(`approve ${PR}`);
		expect(writes.filter((w) => w === "unpark")).toHaveLength(2);
		expect(calls).toMatchObject({read: 2, enqueued: [HEAD]});
		expect(end).toMatchObject({phase: "ended", end: {kind: "terminal", status: "done"}});
		expect(fake.lane.state).toBe("shipped");
	});

	it("a person's open comment parks the lane for a person, with no cause fabrika knows", async () => {
		const {end, fake, names, writes} = await drive(
			{state: "ship", pr: PR},
			{facts: [facts({comments: [{id: "c1", by: "person"}]})]},
			{knobs: {...knobs, askWaitMs: 20}},
		);

		expect(names).toEqual(["ask:commenter:comment"]);
		expect(writes).toContain("record park");
		expect(fake.asked).toHaveLength(1);
		expect(end).toMatchObject({phase: "ended", end: {kind: "parked"}});
	});

	it("a merge queue that says nothing by its limit: the run stops for a person, and says why by the outcome's name", async () => {
		const {end, fake, names, calls} = await drive(
			{state: "ship", pr: PR},
			{facts: [clear], enqueue: ["queued"], queue: "never"},
			{knobs: {...knobs, queueStallMs: 15}},
		);

		expect(names).toEqual(["stuck:queue_silent"]);
		expect(end).toMatchObject({
			phase: "ended",
			end: {kind: "stopped", why: `issue: the ship machine ended \`stuck:queue_silent\` on ${PR}`},
		});
		// The line is written, the pull request is left in the queue, and the working copy is gone.
		expect(fake.lane.state).toBe("blocked");
		expect(calls.enqueued).toEqual([HEAD]);
		expect(fake.trees.standing.size).toBe(0);
	});

	it("a pull request that is not ours stops the run for a person, and nothing is queued", async () => {
		const {end, names, calls} = await drive(
			{state: "ship", pr: PR},
			{facts: [facts({ours: false})]},
		);

		expect(names).toEqual(["skip:not_ours"]);
		expect(end).toMatchObject({
			phase: "ended",
			end: {kind: "stopped", why: expect.stringContaining("`skip:not_ours`")},
		});
		expect(calls.enqueued).toEqual([]);
	});

	it("a restart while the pull request is in the queue carries on from there, and does not queue it twice", async () => {
		const fake = fakeFabrika({lane: "42", state: "ship", pr: PR});
		const world: World = {facts: [clear], enqueue: ["queued"], queue: "never"};
		const host = codeHost(world);
		const store = memoryStore<Operator>();
		const queued = (s: Operator) =>
			s.phase === "driving" &&
			s.turns.issue?.state.phase === "shipping" &&
			s.turns.issue.state.ship.phase === "queued";

		// The first run is killed while the child waits on the merge queue.
		const killed = await runOn(
			fake,
			host,
			{type: "start", run: "r1", lane: "42", knobs},
			{store, until: queued},
		);
		expect(queued(killed)).toBe(true);
		expect(fake.lane.state).toBe("ship");

		// The queue lands it. The second run boots from what the first saved and hears of it.
		world.queue = "landed";
		const end = await runOn(fake, host, {type: "resume"}, {store});

		expect(end).toMatchObject({phase: "ended", end: {kind: "terminal", status: "done"}});
		expect(host.calls).toMatchObject({read: 1, enqueued: [HEAD]});
		// The Listen was opened again by the restart, on the same head.
		expect(host.calls.listened).toEqual([HEAD, HEAD]);
		expect("log" in end ? end.log.ships?.map((row) => row.name) : []).toEqual(["done"]);
		expect(fake.trees.removed).toEqual([TREE]);
	});

	it("a restart while the child's enqueue is in flight sends that Cmd again, under the same intent", () => {
		// Stepped by hand: an engine holds its fold while a Cmd is in flight, so a run cannot be killed there from outside.
		const update = updateWith({ship: "machine"});
		const settle = (cmd: {readonly type: string}, value: unknown) =>
			({type: `${cmd.type}_ok`, cmd: cmd as never, value}) as never;
		const view = {
			lane: "42",
			issue: "https://github.com/example/repo/issues/42",
			status: "active",
			tasks: [{task: "issue", state: "ship", cause: null, pr: PR, seq: 4}],
		};
		let state: Operator = {phase: "idle"};
		let sent: readonly {readonly type: string}[] = [];
		const feed = (msg: OperatorMsg) => {
			[state, sent] = update(state, msg);
			return sent;
		};

		const [claim] = feed({type: "start", run: "r1", lane: "42", knobs});
		const [tree] = feed(settle(claim as never, {won: true, token: "token-1"}));
		const [read] = feed(settle(tree as never, null));
		const [shipRead] = feed(settle(read as never, view));
		const [enqueued] = feed(settle(shipRead as never, clear));

		expect(shipRead).toEqual({type: "ship_facts", pr: PR});
		expect(enqueued).toEqual({
			type: "ship_enqueue",
			pr: PR,
			head: HEAD,
			intent: `ship/${PR}/enqueue/${HEAD}`,
		});
		// Booted again from that state: the same Cmd, and nothing else.
		expect(feed({type: "resume"})).toEqual([enqueued]);
		expect(state).toMatchObject({
			phase: "driving",
			turns: {issue: {state: {phase: "shipping", ship: {phase: "enqueueing"}}}},
		});
	});

	it("the field log tells a machine-shipped lane from an agent-shipped one", async () => {
		const {end} = await drive({shells: toShip}, {facts: [clear], enqueue: ["queued"]});
		const rows = fieldRows(end, {
			date: "2026-10-11",
			repo: "example/repo",
			minutes: 3,
			model: "opus",
			effort: "medium",
		});
		const shipped = rows.filter((row) => row.role === "shipper");

		expect(rows.map((row) => row.role)).toEqual(["machine", "builder", "reviewer", "shipper"]);
		expect(shipped).toEqual([
			{
				date: "2026-10-11",
				lane: "example/repo#42",
				role: "shipper",
				model: null,
				effort: null,
				outcome: "merged",
				why: null,
				tokens: 0,
				tools: 0,
				minutes: 0,
				note: `the ship machine, no agent: reading > enqueueing > queued > finishing > over; ended done on ${PR}`,
				costUsd: 0,
			},
		]);
	});
});

describe("with the switch off, nothing changes", () => {
	it("a shipper shell is started, no ship child exists, and no code host is asked for", async () => {
		const fake = fakeFabrika({
			lane: "42",
			shells: [...toShip, {shell: "shipper", reports: "DONE", says: say("MERGED")}],
		});
		const seen: string[] = [];
		const program = Effect.gen(function* () {
			const handle = yield* run(createOperator(2), {
				ctx: undefined,
				interpret: operatorInterpret("jev-test"),
				subscribe: {...operatorSubscribe({pollMs: 1, shell: NO_SHELLS}), shell: fake.shellRunner},
				terminal: (s) => s.phase === "ended",
			});
			const runtime = yield* handle.ready;
			runtime.observe((_msg, s) => {
				if (s.phase === "driving")
					seen.push(...Object.values(s.turns).map((turn) => turn.state.phase));
			});
			yield* runtime.dispatch({type: "start", run: "r1", lane: "42", knobs});
			return yield* runtime.done().pipe(Effect.timeout("4 seconds"));
		});
		// No `CodeHost` and no `CodeHostWrites` are provided: with the switch off the machine needs neither.
		const end = await Effect.runPromise(
			program.pipe(
				Effect.scoped,
				Effect.provide(Layer.mergeAll(fake.layer, fake.thread, scriptedJev([] as never))),
			),
		);

		expect(end).toMatchObject({phase: "ended", end: {kind: "terminal", status: "done"}});
		expect(fake.dispatched).toEqual(["builder", "reviewer", "shipper"]);
		expect(seen).not.toContain("shipping");
		expect("log" in end && end.log.ships).toBeUndefined();
		expect("log" in end && end.log.shells.map((row) => row.shell)).toEqual([
			"builder",
			"reviewer",
			"shipper",
		]);
	});

	it("the machine made with the switch off declares none of the ship machine's Cmds or Listens", () => {
		const off = createOperator(2);
		const on = createOperator(2, {ship: "machine"});
		const cmdsOf = (machine: {readonly cmds?: readonly {readonly cmdType: string}[]}) =>
			(machine.cmds ?? []).map((def) => def.cmdType);

		expect(cmdsOf(off).filter((type) => type.startsWith("ship_"))).toEqual([]);
		expect(cmdsOf(on).filter((type) => type.startsWith("ship_"))).toEqual([
			"ship_facts",
			"ship_rerun_checks",
			"ship_enqueue",
			"ship_finish",
		]);
		expect(Object.keys(off.update).filter((type) => type.startsWith("ship_"))).toEqual([]);
		expect(
			(off.subs ?? []).map((sub) => sub.type).filter((type) => type.startsWith("ship_")),
		).toEqual([]);
		expect(
			new Set((on.subs ?? []).map((sub) => sub.type).filter((type) => type.startsWith("ship_"))),
		).toEqual(new Set(["ship_checks", "ship_queue"]));
	});
});

describe("the one line a ship's outcome writes on the lane", () => {
	const token = (word: string) => ({kind: "token", token: word, pr: PR});
	const stopped = (name: string) => ({
		kind: "stopped",
		why: `the ship machine ended \`${name}\` on ${PR}`,
	});

	it.each<[ShipOutcome, unknown, unknown]>([
		[{kind: "done", part: false, commit: MERGE, cleanup: "done"}, token("LANDED"), undefined],
		[{kind: "done", part: true, commit: MERGE, cleanup: "failed"}, token("LANDED"), undefined],
		// Found already merged: today's word for it.
		[
			{kind: "done", part: false, commit: HEAD, cleanup: "not_run"},
			token("ALREADY-MERGED"),
			undefined,
		],
		[{kind: "send", to: "builder", why: "review_failed"}, token("ROUTED-REPAIR"), undefined],
		[{kind: "send", to: "builder", why: "checks_red"}, token("ROUTED-REPAIR"), undefined],
		[{kind: "send", to: "builder", why: "bot_comment"}, token("ROUTED-REPAIR"), undefined],
		[{kind: "send", to: "builder", why: "conflicts"}, {kind: "base_conflicted", pr: PR}, undefined],
		[{kind: "send", to: "builder", why: "ejected"}, token("EJECTED"), undefined],
		[{kind: "send", to: "reviewer", why: "no_review"}, token("ROUTED-REVIEW"), undefined],
		[{kind: "ask", who: "owner", for: "approval"}, token("AWAITING-CP-APPROVAL"), undefined],
		[
			{kind: "ask", who: "commenter", for: "comment"},
			{kind: "park", cause: null, why: "the ship machine ended `ask:commenter:comment`"},
			undefined,
		],
		[{kind: "skip", why: "closed"}, token("REFUSED"), stopped("skip:closed")],
		[{kind: "skip", why: "draft"}, token("REFUSED"), stopped("skip:draft")],
		[{kind: "skip", why: "not_ours"}, token("REFUSED"), stopped("skip:not_ours")],
		[{kind: "stuck", why: "read_failed"}, token("UNKNOWN"), stopped("stuck:read_failed")],
		[{kind: "stuck", why: "enqueue_failed"}, token("UNKNOWN"), stopped("stuck:enqueue_failed")],
		[{kind: "stuck", why: "checks_stuck"}, token("UNKNOWN"), stopped("stuck:checks_stuck")],
	])("%j", (outcome, fact, after) => {
		expect(shipLine(outcome, PR)).toEqual(after === undefined ? {fact} : {fact, after});
	});
});
