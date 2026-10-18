// Experiment 87, kamp-us/demlik issue 631: the glue for effect-cmd.feature.
// Copied to `packages/tea/scen87/631-effect-cmd/` in a scratch checkout, so
// `../../src` is tea's source.
//
// The Effect entry is read as a namespace and its `Cmd` looked up when a step
// runs, so a checkout without it fails that step with a sentence, and the
// feature's other scenarios still run.
import {Cause, Effect, Exit, Schema, SchemaGetter} from "effect";
import * as entry from "../../src/effect/index.ts";
import {AsyncSchemaError, Cmd as CoreCmd, defineMachine} from "../../src/index.ts";
import {drive} from "../../src/testing/effect/index.ts";
import {expectThat, Given, need, Then, When, type World} from "../lib/moves.ts";

/** The `Cmd` of `@demlik/tea/effect`, or a failed step saying it is not there. */
function effectCmd(): typeof CoreCmd {
	const found = (entry as Record<string, unknown>).Cmd as typeof CoreCmd | undefined;
	if (found === undefined) throw new Error("@demlik/tea/effect exports no Cmd");
	return found;
}

const Input = Schema.Struct({id: Schema.String});
const Profile = Schema.Struct({name: Schema.String});
const Status = Schema.Literals(["open", "held", "closed"]);
const Order = Schema.Struct({
	customer: Schema.Struct({name: Schema.String}),
	lines: Schema.Array(Schema.String),
});

// The define functions differ in what they take; the scenario's point is that
// both build the same Cmd. Each set is built through a loose `define`.
type Define = (
	name: string,
	spec: {input: unknown; ok: unknown; err: readonly string[]},
) => unknown;
const loose = (define: unknown) => define as Define;
const plain = (s: unknown) => s;
const wrapped = (s: unknown) => Schema.toStandardSchemaV1(s as Schema.Top);

function cmdsOf(define: Define, schema: (s: unknown) => unknown) {
	const make = (name: string, ok: unknown) =>
		define(name, {input: schema(Input), ok: schema(ok), err: ["unknown"]}) as (input: {
			id: string;
		}) => {type: string};
	return {
		profile: make("profile_read", Profile),
		status: make("status_read", Status),
		order: make("order_read", Order),
	};
}

type Cmds = ReturnType<typeof cmdsOf>;
type Model = {
	readonly profile: string | null;
	readonly status: string | null;
	readonly order: {readonly customer: string; readonly lines: readonly string[]} | null;
	readonly errors: readonly string[];
};
const start: Model = {profile: null, status: null, order: null, errors: []};

type Msg = {
	readonly type: string;
	readonly value?: never;
	readonly error?: {readonly _tag: string};
};

function machineOf(cmds: Cmds) {
	const failed = (m: Model, msg: {type: string; error: {_tag: string}}): [Model, never[]] => [
		{...m, errors: [...m.errors, `${msg.type}:${msg.error._tag}`]},
		[],
	];
	return defineMachine({
		types: {model: {} as Model, msg: {} as {readonly type: "go"}},
		cmds: [cmds.profile, cmds.status, cmds.order] as never,
		init: () => [start, []],
		update: {
			go: (m: Model) => [
				m,
				[cmds.profile({id: "1"}), cmds.status({id: "1"}), cmds.order({id: "1"})],
			],
			profile_read_ok: (m: Model, msg: {value: {name: string}}) => [
				{...m, profile: msg.value.name},
				[],
			],
			status_read_ok: (m: Model, msg: {value: string}) => [{...m, status: msg.value}, []],
			order_read_ok: (m: Model, msg: {value: {customer: {name: string}; lines: string[]}}) => [
				{...m, order: {customer: msg.value.customer.name, lines: msg.value.lines}},
				[],
			],
			profile_read_err: failed,
			status_read_err: failed,
			order_read_err: failed,
		} as never,
	});
}

const GOOD = {
	profile: {name: "Ada"},
	status: "held" as unknown,
	order: {customer: {name: "Ada"}, lines: ["tea", "cups"]},
};

/** Run one machine on the Effect engine; its end state and the Msgs it saw. */
async function runOnce(cmds: Cmds, answers: typeof GOOD) {
	const seen: string[] = [];
	const state = await Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const rt = yield* entry.run(
					machineOf(cmds) as never,
					{
						interpret: {
							profile_read: () => Effect.succeed(answers.profile),
							status_read: () => Effect.succeed(answers.status),
							order_read: () => Effect.succeed(answers.order),
						},
					} as never,
				);
				const booted = yield* (rt as {ready: Effect.Effect<Booted>}).ready;
				// A settled Msg carries `at`, the clock when it settled. Fixed after the first
				// run at the merge commit: the glue compared it too, so two runs never matched.
				booted.observe(({at: _clock, ...msg}) => {
					seen.push(JSON.stringify(msg));
				});
				yield* booted.dispatch({type: "go"});
				return booted.getState();
			}),
		),
	);
	return {state, seen};
}
type Booted = {
	observe(f: (msg: Msg & {readonly at?: number}) => void): void;
	dispatch(msg: {type: "go"}): Effect.Effect<void>;
	getState(): Model;
};

type Ran = Awaited<ReturnType<typeof runOnce>>;

// A `/` in a Cucumber expression means "or", so a package path is written `\\/`.
Given(
	"provide",
	"the Cmds profile, status and order defined with the Cmd.define of @demlik\\/tea\\/effect",
	(world) => {
		world.data.helper = cmdsOf(loose(effectCmd().define), plain);
	},
);

Given(
	"provide",
	"the same three Cmds defined with the core Cmd.define and Schema.toStandardSchemaV1",
	(world) => {
		world.data.hand = cmdsOf(loose(CoreCmd.define), wrapped);
	},
);

async function runBoth(world: World, answers: typeof GOOD) {
	const runs = (world.data.runs ?? []) as {helper: Ran; hand: Ran}[];
	runs.push({
		helper: await runOnce(need<Cmds>(world, "helper"), answers),
		hand: await runOnce(need<Cmds>(world, "hand"), answers),
	});
	world.data.runs = runs;
	world.data.answers = answers;
}

When(
	"act",
	"both machines run on the Effect engine and every handler answers a good value",
	(world) => runBoth(world, GOOD),
);

When(
	"act",
	"both machines run on the Effect engine and the status handler answers {string}",
	(world, value) => runBoth(world, {...GOOD, status: String(value)}),
);

When("act", "both machines run again", (world) =>
	runBoth(world, need<typeof GOOD>(world, "answers")),
);

const last = (world: World) =>
	need<{helper: Ran; hand: Ran}[]>(world, "runs").at(-1) as {helper: Ran; hand: Ran};

Then("check", "both machines end in the same state", (world) => {
	const {helper, hand} = last(world);
	return expectThat(
		JSON.stringify(helper.state) === JSON.stringify(hand.state),
		`helper ended ${JSON.stringify(helper.state)}, hand-wrapped ${JSON.stringify(hand.state)}`,
	);
});

Then(
	"check",
	"the state holds the profile name, the status and the order's nested customer and lines",
	(world) => {
		const {state} = last(world).helper;
		const want: Model = {
			profile: "Ada",
			status: "held",
			order: {customer: "Ada", lines: ["tea", "cups"]},
			errors: [],
		};
		return expectThat(
			JSON.stringify(state) === JSON.stringify(want),
			`the state is ${JSON.stringify(state)}`,
		);
	},
);

Then("check", "the status Cmd settled on its _err Msg with malformed_result", (world) => {
	const {state} = last(world).helper;
	return expectThat(
		state.status === null && state.errors.includes("status_read_err:malformed_result"),
		`the state is ${JSON.stringify(state)}`,
	);
});

Then(
	"check",
	"each machine saw the same Msgs both times, and the two machines saw the same Msgs",
	(world) => {
		const runs = need<{helper: Ran; hand: Ran}[]>(world, "runs");
		const [first, second] = runs;
		if (first === undefined || second === undefined) return ["fewer than two runs"];
		const sorted = (r: Ran) => [...r.seen].sort().join("\n");
		return [
			...expectThat(
				first.helper.seen.length >= 4,
				`the helper machine saw ${first.helper.seen.length} Msgs`,
			),
			...expectThat(
				sorted(first.helper) === sorted(second.helper),
				`the helper machine saw other Msgs the second time:\n${sorted(first.helper)}\n---\n${sorted(second.helper)}`,
			),
			...expectThat(
				sorted(first.hand) === sorted(second.hand),
				"the hand-wrapped machine saw other Msgs the second time",
			),
			...expectThat(
				sorted(first.helper) === sorted(first.hand),
				"the two machines saw different Msgs",
			),
		];
	},
);

// ------------------------------------------------------------ a schema that needs a Promise

/** A string whose decode sleeps: the same type on both sides, so only the settle can refuse it. */
const Slow = Schema.String.pipe(
	Schema.decodeTo(Schema.String, {
		decode: SchemaGetter.transformEffect((s: string) => Effect.as(Effect.sleep("1 millis"), s)),
		encode: SchemaGetter.passthrough(),
	}),
);

Given(
	"provide",
	"a Cmd whose ok schema checks its value with an Effect that sleeps, defined both ways",
	(world) => {
		world.data.hand = CoreCmd.define("slow_read", {
			input: Schema.toStandardSchemaV1(Input),
			ok: Schema.toStandardSchemaV1(Slow),
			err: ["unknown"],
		});
		world.data.helper = loose(effectCmd().define)("slow_read", {
			input: Input,
			ok: Slow,
			err: ["unknown"],
		});
	},
);

/** Drive one Cmd once; every error the run surfaced, wherever it surfaced. */
async function driveOne(cmd: unknown): Promise<unknown[]> {
	const machine = defineMachine({
		types: {model: {} as {readonly got: string | null}, msg: {} as {readonly type: "go"}},
		cmds: [cmd] as never,
		init: () => [{got: null}, []],
		update: {
			go: (m: {got: string | null}) => [m, [(cmd as (i: {id: string}) => unknown)({id: "1"})]],
			slow_read_ok: (_m: unknown, msg: {value: string}) => [{got: msg.value}, []],
			slow_read_err: (m: unknown) => [m, []],
		} as never,
	});
	const exit = await Effect.runPromiseExit(
		drive(
			machine as never,
			{got: null} as never,
			{type: "go"} as never,
			{slow_read: () => Effect.succeed("x")} as never,
		) as Effect.Effect<unknown, unknown>,
	);
	if (Exit.isSuccess(exit)) return [];
	const error = Cause.squash(exit.cause);
	return [error, (error as {cause?: unknown}).cause];
}

When("act", "each is driven with drive from @demlik\\/tea\\/testing\\/effect", async (world) => {
	world.data.refusals = {
		helper: await driveOne(need(world, "helper")),
		hand: await driveOne(need(world, "hand")),
	};
});

const asyncError = (errors: unknown[]) =>
	errors.find((e) => e instanceof AsyncSchemaError) as Error | undefined;

Then("check", "both are refused with AsyncSchemaError", (world) => {
	const {helper, hand} = need<{helper: unknown[]; hand: unknown[]}>(world, "refusals");
	return [
		...expectThat(
			asyncError(helper) !== undefined,
			`the helper's Cmd was not refused: ${String(helper[0])}`,
		),
		...expectThat(
			asyncError(hand) !== undefined,
			`the hand-wrapped Cmd was not refused: ${String(hand[0])}`,
		),
	];
});

Then("check", "the two refusals carry the same message", (world) => {
	const {helper, hand} = need<{helper: unknown[]; hand: unknown[]}>(world, "refusals");
	const a = asyncError(helper)?.message;
	const b = asyncError(hand)?.message;
	return expectThat(a !== undefined && a === b, `the messages differ:\n${a}\n${b}`);
});
