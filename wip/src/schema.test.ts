import {AsyncSchemaError, Cmd as CoreCmd, defineMachine, type Settled} from "@demlik/tea";
import {Cmd, run} from "@demlik/tea/effect";
import {drive} from "@demlik/tea/testing/effect";
import {Context, Effect, Exit, Layer, Option, Schema, SchemaGetter} from "effect";
import {describe, expect, it} from "vitest";
import {z} from "zod";
import {createDraft} from "./draft.ts";
import {act, checkRun, createJudge, gather, intentOf} from "./primitives.ts";
import {jsonSchema, reader} from "./schema.ts";
import {Jev} from "./services.ts";

// Cmds from Effect schemas: tea's own `Cmd.define` from `@demlik/tea/effect`
// and each move in its Effect form, beside the zod form the code not yet moved
// still uses. One small machine carries all of them and is run on the Effect
// engine.

const Ticket = Schema.Struct({
	id: Schema.String,
	title: Schema.String,
	kind: Schema.Literals(["bug", "feature", "chore"]),
	pr: Schema.NullOr(Schema.String),
	labels: Schema.Array(Schema.String),
});
type Ticket = typeof Ticket.Type;
const Id = Schema.Struct({id: Schema.String});

// tea's `Cmd.define`, and each move, handed Effect schemas.
const readTicket = Cmd.define("ticket_read", {input: Id, ok: Ticket, err: ["unknown", "gone"]});
const sizeOf = gather("ticket_size", {
	input: Id,
	ok: Schema.Literals(["small", "medium", "large"]),
	err: ["unknown"],
});
const addLabel = act("ticket_label", {
	input: Schema.Struct({id: Schema.String, label: Schema.String}),
	ok: Schema.Null,
	err: ["unknown"],
});
const runTests = checkRun("ticket_test", {
	input: Id,
	verdict: Schema.Struct({passed: Schema.Boolean, failed: Schema.Array(Schema.String)}),
});
const urgency = createJudge({
	name: "urgent",
	instructions: "`title` is a ticket's title. Does it need doing now?",
	choices: {now: "It blocks people today", later: "It can wait"},
});
// The code not yet moved: tea's core `Cmd.define` over zod, and a move with a zod slot beside an Effect one.
const readComments = CoreCmd.define("ticket_comments", {
	input: z.object({id: z.string()}),
	ok: z.array(z.string()),
	err: ["unknown"],
});
const readOwner = gather("ticket_owner", {
	input: z.object({id: z.string()}),
	ok: Schema.Struct({owner: Schema.String}),
	err: ["unknown"],
});

type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

interface Desk {
	readonly ticket: Ticket | null;
	readonly size: "small" | "medium" | "large" | null;
	readonly labelled: string | null;
	readonly failed: readonly string[];
	readonly urgent: {readonly choice: "now" | "later"; readonly confidence: number} | null;
	readonly comments: readonly string[];
	readonly owner: string | null;
	/** Each Cmd that failed, with the tag it failed with. */
	readonly errors: readonly string[];
}
const empty: Desk = {
	ticket: null,
	size: null,
	labelled: null,
	failed: [],
	urgent: null,
	comments: [],
	owner: null,
	errors: [],
};
type DeskMsg = {readonly type: "start"; readonly id: string};

const cmds = [
	readTicket,
	sizeOf,
	addLabel,
	runTests,
	urgency.ask,
	readComments,
	readOwner,
] as const;
type DeskCmd = ReturnType<(typeof cmds)[number]>;
type Step = readonly [Desk, readonly DeskCmd[]];
const failed = (
	s: Desk,
	m: {readonly type: string; readonly error: {readonly _tag: string}},
): Step => [{...s, errors: [...s.errors, `${m.type}: ${m.error._tag}`]}, []];

/** One ticket, read and worked through every Cmd in turn. A Cmd that fails ends the chain there. */
const desk = defineMachine({
	types: {model: {} as Desk, msg: {} as DeskMsg, ctx: undefined},
	cmds,
	init: (loaded) => [loaded ?? empty, []],
	update: {
		start: (_, m): Step => [empty, [readTicket({id: m.id})]],
		ticket_read_ok: (s, m): Step => [{...s, ticket: m.value}, [sizeOf({id: m.cmd.id})]],
		ticket_size_ok: (s, m): Step => [
			{...s, size: m.value},
			[
				addLabel({
					id: m.cmd.id,
					label: `size:${m.value}`,
					intent: intentOf("desk", m.cmd.id, "label"),
				}),
			],
		],
		ticket_label_ok: (s, m): Step => [{...s, labelled: m.cmd.intent}, [runTests({id: m.cmd.id})]],
		ticket_test_ok: (s, m): Step => [
			{...s, failed: m.value.failed},
			[urgency.ask({key: m.cmd.id, texts: {title: s.ticket?.title ?? ""}})],
		],
		urgent_judge_ok: (s, m): Step => [{...s, urgent: m.value}, [readComments({id: m.cmd.key})]],
		ticket_comments_ok: (s, m): Step => [{...s, comments: m.value}, [readOwner({id: m.cmd.id})]],
		ticket_owner_ok: (s, m): Step => [{...s, owner: m.value.owner}, []],
		ticket_read_err: failed,
		ticket_size_err: failed,
		ticket_label_err: failed,
		ticket_test_err: failed,
		urgent_judge_err: failed,
		ticket_comments_err: failed,
		ticket_owner_err: failed,
	},
});

const ticket: Ticket = {
	id: "7",
	title: "slugify drops accents",
	kind: "bug",
	pr: null,
	labels: ["text"],
};
/** What the world answers. A test swaps one answer for a wrong one. */
const world = {
	ticket: ticket as unknown,
	size: "small" as unknown,
	verdict: {passed: false, failed: ["slugify keeps accents"]} as unknown,
	comments: ["me too"] as unknown,
};
type World = typeof world;

/** The handlers, as a host would write them. Each hands back what the world says, unchecked: the check is the Cmd's. */
const interpret = (w: World = world) => ({
	ticket_read: (c: ReturnType<typeof readTicket>) =>
		c.id === "404" ? Effect.fail({_tag: "gone" as const}) : Effect.succeed(w.ticket as Ticket),
	ticket_size: (_: ReturnType<typeof sizeOf>) => Effect.succeed(w.size as "small"),
	ticket_label: (_: ReturnType<typeof addLabel>) => Effect.succeed(null),
	ticket_test: (_: ReturnType<typeof runTests>) =>
		Effect.succeed(w.verdict as {passed: boolean; failed: string[]}),
	urgent_judge: urgency.handle("jev-test"),
	ticket_comments: (_: ReturnType<typeof readComments>) => Effect.succeed(w.comments as string[]),
	ticket_owner: (_: ReturnType<typeof readOwner>) => Effect.succeed({owner: "docs"}),
});

/** Jev, standing in: every question it is asked comes back "now", 0.9 sure. */
const jev = () =>
	Layer.succeed(Jev, {
		call: (request) =>
			Effect.succeed({
				status: 200,
				body: {
					model: request.model,
					answers: Object.fromEntries(
						Object.keys(request.questions).map((id) => [
							id,
							{
								type: "choice",
								choice: "now",
								confidence: 0.9,
								probabilities: {now: 0.9, later: 0.1},
							},
						]),
					),
					usage: {input_tokens: 0, output_tokens: 0},
				},
			}),
	});
/** A still clock, so two drives stamp their Msgs the same. */
const driveDesk = (id: string, w: World = world) =>
	Effect.runPromise(
		drive(desk, empty, {type: "start", id}, interpret(w), {clock: () => 0}).pipe(
			Effect.provide(jev()),
		),
	);
const typesOf = (trace: Awaited<ReturnType<typeof driveDesk>>["trace"]) =>
	trace.flatMap((entry) => (entry.kind === "cmd" ? [entry.cmd.type] : []));

const whole: Desk = {
	ticket,
	size: "small",
	labelled: "desk/7/label",
	failed: ["slugify keeps accents"],
	urgent: {choice: "now", confidence: 0.9},
	comments: ["me too"],
	owner: "docs",
	errors: [],
};

describe("a machine whose Cmds are defined from Effect schemas and from zod, side by side", () => {
	it("runs every Cmd on the Effect engine, each answer typed in update, and the same on a second run", async () => {
		const program = Effect.gen(function* () {
			const handle = yield* run(desk, {
				ctx: undefined,
				interpret: interpret(),
				terminal: (s) => s.owner !== null,
			});
			const runtime = yield* handle.ready;
			yield* runtime.dispatch({type: "start", id: "7"});
			return yield* runtime.done().pipe(Effect.timeout("4 seconds"));
		});
		const live = () => Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(jev())));

		expect(await live()).toEqual(whole);
		expect(await live()).toEqual(whole);
	});

	it("drives the same through the test `drive`, with the same Cmds and Msgs each time", async () => {
		const first = await driveDesk("7");
		const second = await driveDesk("7");

		expect(first.state).toEqual(whole);
		expect(typesOf(first.trace)).toEqual([
			"ticket_read",
			"ticket_size",
			"ticket_label",
			"ticket_test",
			"urgent_judge",
			"ticket_comments",
			"ticket_owner",
		]);
		expect(second.trace).toEqual(first.trace);
	});

	it("an Act carries the intent its model named, into the Cmd and back with its answer", async () => {
		const {trace, state} = await driveDesk("7");
		const sent = trace.flatMap((entry) =>
			entry.kind === "cmd" && entry.cmd.type === "ticket_label" ? [entry.cmd] : [],
		);

		expect(sent).toEqual([
			{type: "ticket_label", id: "7", label: "size:small", intent: "desk/7/label"},
		]);
		expect(state.labelled).toBe("desk/7/label");
		// The field is in the schema too, not only in the type.
		expect(addLabel.schema.input["~standard"].validate({id: "7", label: "x"})).toMatchObject({
			issues: [{path: ["intent"]}],
		});
		expect(addLabel.schema.input["~standard"].validate({id: "7", label: "x", intent: "i"})).toEqual(
			{
				value: {id: "7", label: "x", intent: "i"},
			},
		);
	});

	it("a declared failure comes back as the Cmd's `_err`, with its tag", async () => {
		const {state} = await driveDesk("404");

		expect(state).toEqual({...empty, errors: ["ticket_read_err: gone"]});
	});
});

describe("a value the `ok` schema rejects is tea's `malformed_result`, as with zod", () => {
	const errorOf = async (w: World, type: string) => {
		const {trace} = await driveDesk("7", w);
		return trace.flatMap((entry) =>
			entry.kind === "msg" && entry.msg.type === type
				? [(entry.msg as {error: unknown}).error]
				: [],
		);
	};

	it("for the helper: the wrong fields are named, by path", async () => {
		const wrong = {...world, ticket: {...ticket, kind: "epic", labels: "text"}};

		expect(await errorOf(wrong, "ticket_read_err")).toEqual([
			{
				_tag: "malformed_result",
				issues: [
					{path: "kind", message: 'Expected "bug" | "feature" | "chore"'},
					{path: "labels", message: "Expected array"},
				],
			},
		]);
		expect((await driveDesk("7", wrong)).state).toEqual({
			...empty,
			errors: ["ticket_read_err: malformed_result"],
		});
	});

	it("in the same shape a zod Cmd's has: a path and a message, where only the wording is the library's", async () => {
		const [fromZod] = await errorOf({...world, comments: ["me too", 7]}, "ticket_comments_err");
		const [fromEffect] = await errorOf(
			{...world, ticket: {...ticket, labels: ["text", 7]}},
			"ticket_read_err",
		);

		expect(fromZod).toEqual({
			_tag: "malformed_result",
			issues: [{path: "1", message: "Invalid input: expected string, received number"}],
		});
		expect(fromEffect).toEqual({
			_tag: "malformed_result",
			issues: [{path: "labels.1", message: "Expected string"}],
		});
	});

	it("for a Gather whose answer is one of three words", async () => {
		expect(await errorOf({...world, size: "huge"}, "ticket_size_err")).toMatchObject([
			{_tag: "malformed_result", issues: [{path: ""}]},
		]);
	});

	it("for a Check's verdict", async () => {
		const wrong = {...world, verdict: {passed: "no", failed: []}};

		expect(await errorOf(wrong, "ticket_test_err")).toMatchObject([
			{_tag: "malformed_result", issues: [{path: "passed"}]},
		]);
	});

	it("for a Judge: a choice it was not given, or a confidence that is not a number", () => {
		const check = (value: unknown) => urgency.ask.schema.ok["~standard"].validate(value);

		expect(check({choice: "now", confidence: 0.9})).toEqual({
			value: {choice: "now", confidence: 0.9},
		});
		expect(check({choice: "never", confidence: 0.9})).toMatchObject({issues: [{path: ["choice"]}]});
		expect(check({choice: "now", confidence: Number.NaN})).toMatchObject({
			issues: [{path: ["confidence"]}],
		});
	});
});

describe("the types flow from the Effect schemas, with no cast and no wrapper at the call site", () => {
	it("gives the same Cmd as the core `Cmd.define` over the hand-wrapped schemas", () => {
		const byHand = CoreCmd.define("ticket_read", {
			input: Schema.toStandardSchemaV1(Id),
			ok: Schema.toStandardSchemaV1(Ticket),
			err: ["unknown", "gone"],
		});
		const same: Eq<typeof readTicket, typeof byHand> = true;
		const sameMsgs: Eq<Settled<typeof readTicket>, Settled<typeof byHand>> = true;

		expect([same, sameMsgs]).toEqual([true, true]);
		expect([readTicket.cmdType, readTicket.okType, readTicket.errType]).toEqual([
			byHand.cmdType,
			byHand.okType,
			byHand.errType,
		]);
		expect(readTicket.errTags).toEqual(["unknown", "gone"]);
		expect(readTicket({id: "7"})).toEqual(byHand({id: "7"}));
	});

	it("refuses a wrong input, a wrong use of an answer, and an Act with no intent", () => {
		// @ts-expect-error `id` is a string
		readTicket({id: 7});
		// @ts-expect-error an Act's input has an `intent`
		addLabel({id: "7", label: "x"});
		// @ts-expect-error a Gather has none
		sizeOf({id: "7", intent: "i"});

		const ok = (m: Extract<Settled<typeof readTicket>, {type: "ticket_read_ok"}>) => {
			const kind: "bug" | "feature" | "chore" = m.value.kind;
			// @ts-expect-error `kind` is one of three words, and "epic" is not one
			const epic: "epic" = m.value.kind;
			// @ts-expect-error `pr` may be null
			const pr: string = m.value.pr;
			return [kind, epic, pr];
		};
		const err = (m: Extract<Settled<typeof readTicket>, {type: "ticket_read_err"}>) => {
			const tag: "unknown" | "gone" | "malformed_result" = m.error._tag;
			// @ts-expect-error tea adds `malformed_result` to the declared tags
			const declared: "unknown" | "gone" = m.error._tag;
			return [tag, declared];
		};
		const size = (m: Extract<Settled<typeof sizeOf>, {type: "ticket_size_ok"}>) => {
			// @ts-expect-error the answer is a word, not a number
			const n: number = m.value;
			return n;
		};
		const verdict = (m: Extract<Settled<typeof runTests>, {type: "ticket_test_ok"}>) => {
			// @ts-expect-error `passed` is a boolean
			const passed: string = m.value.passed;
			return passed;
		};
		const notRun = (m: Extract<Settled<typeof runTests>, {type: "ticket_test_err"}>) => {
			const tag: "could_not_run" | "malformed_result" = m.error._tag;
			// @ts-expect-error a Check fails one way, and "unknown" is not it
			const other: "unknown" = m.error._tag;
			return [tag, other];
		};
		const judged = (m: Extract<Settled<typeof urgency.ask>, {type: "urgent_judge_ok"}>) => {
			// @ts-expect-error a Judge answers with one of its own choices
			const choice: "maybe" = m.value.choice;
			return choice;
		};

		expect([ok, err, size, verdict, notRun, judged].every((f) => typeof f === "function")).toBe(
			true,
		);
	});

	it("refuses, at the call, a schema whose two sides differ, and takes its type side", () => {
		const Count = Schema.Struct({n: Schema.FiniteFromString});
		// @ts-expect-error the handler would be typed to answer a number while the check wants a string
		gather("count", {input: Id, ok: Count, err: []});
		// @ts-expect-error the same for an input: a Cmd holds its values, it does not decode them
		gather("count", {input: Count, ok: Schema.Null, err: []});
		// @ts-expect-error and for a brand, which only the type side carries
		gather("count", {input: Id, ok: Schema.String.pipe(Schema.brand("TicketId")), err: []});

		const counted = gather("count", {input: Id, ok: Schema.toType(Count), err: []});
		expect(counted.schema.ok["~standard"].validate({n: 3})).toEqual({value: {n: 3}});
		expect(counted.schema.ok["~standard"].validate({n: "3"})).toMatchObject({
			issues: [{path: ["n"]}],
		});
	});

	it("keeps a zod caller's Cmd exactly as it was", () => {
		const spec = {
			input: z.object({id: z.string()}),
			ok: z.object({lines: z.array(z.string())}),
			err: ["unknown"],
		} as const;
		const before = CoreCmd.define("old", spec);
		const beforeAct = CoreCmd.define("old", {
			...spec,
			input: spec.input.extend({intent: z.string()}),
		});
		const read = gather("old", spec);
		const write = act("old", spec);
		const sameRead: Eq<typeof read, typeof before> = true;
		const sameWrite: Eq<typeof write, typeof beforeAct> = true;

		expect([sameRead, sameWrite]).toEqual([true, true]);
		expect(write({id: "7", intent: "i"})).toEqual({type: "old", id: "7", intent: "i"});
		// zod's own schema object goes through untouched.
		expect(read.schema.ok).toBe(spec.ok);
	});
});

describe("tea checks a schema synchronously", () => {
	/** A string that takes a Promise to read. Both sides are strings, so it compiles. */
	const Slow = Schema.String.pipe(
		Schema.decode({
			// biome-ignore lint/plugin: the test needs an Effect that takes a Promise to answer, and this Promise cannot reject
			decode: SchemaGetter.transformEffect((s: string) => Effect.promise(async () => s)),
			encode: SchemaGetter.passthrough(),
		}),
	);

	it("an `ok` schema that needs a Promise is refused when the Cmd settles, with tea's own error", async () => {
		const slow = gather("slow", {input: Id, ok: Slow, err: []});
		const machine = defineMachine({
			types: {model: {} as {said: string | null}, msg: {} as {type: "go"}, ctx: undefined},
			cmds: [slow],
			init: (loaded) => [loaded ?? {said: null}, []],
			update: {
				go: (s) => [s, [slow({id: "7"})]],
				slow_ok: (_, m) => [{said: m.value}, []],
				slow_err: (s) => [s, []],
			},
		});

		const exit = await Effect.runPromiseExit(
			drive(machine, {said: null}, {type: "go"}, {slow: () => Effect.succeed("hi")}),
		);

		expect(Exit.isFailure(exit)).toBe(true);
		expect(String(Exit.isFailure(exit) ? exit.cause : "")).toContain(
			new AsyncSchemaError('the "slow" Cmd\'s ok schema').message,
		);
	});

	it("a schema that needs a service to answer does not compile", () => {
		class Clock extends Context.Service<Clock, {readonly now: number}>()("Clock") {}
		const Needy = Schema.String.pipe(
			Schema.decode({
				decode: SchemaGetter.transformEffect((s: string) =>
					Effect.map(Effect.service(Clock), () => s),
				),
				encode: SchemaGetter.passthrough(),
			}),
		);
		// @ts-expect-error decoding it needs a `Clock`, and a Cmd's check has nowhere to get one
		gather("needy", {input: Id, ok: Needy, err: []});

		expect(Schema.isSchema(Needy)).toBe(true);
	});

	it("a Draft's schema is read synchronously too: one that needs a Promise throws at the first answer", () => {
		expect(() => reader(Slow)("hi")).toThrow();
		expect(Option.getOrNull(reader(Schema.String)("hi"))).toBe("hi");
	});
});

describe("a Draft from an Effect schema", () => {
	const ShellEnd = Schema.Struct({token: Schema.String, pr: Schema.NullOr(Schema.String)});
	const draft = createDraft({name: "shell", output: ShellEnd});
	const run = {
		key: "k",
		id: "k/1",
		prompt: "p",
		session: {id: "s", continues: false},
		agent: null,
		folder: null,
	};
	const result = (fields: object, d: {msgsOf: typeof draft.msgsOf} = draft) =>
		d.msgsOf(
			{
				type: "result",
				subtype: "success",
				is_error: false,
				total_cost_usd: 0,
				num_turns: 1,
				duration_ms: 0,
				session_id: "s",
				usage: {input_tokens: 0, output_tokens: 0},
				...fields,
			} as never,
			run,
		)[0];

	it("hands the agent a JSON Schema the Agent SDK takes: one closed object, no `$schema` line", () => {
		expect(draft.schema).toEqual({
			type: "object",
			properties: {token: {type: "string"}, pr: {anyOf: [{type: "string"}, {type: "null"}]}},
			required: ["token", "pr"],
			additionalProperties: false,
		});
		// The zod form of the same shape, for the code not yet moved: the same, but for how "or null" is spelled.
		expect(
			createDraft({name: "shell", output: z.object({token: z.string(), pr: z.string().nullable()})})
				.schema,
		).toEqual({
			type: "object",
			properties: {token: {type: "string"}, pr: {type: ["string", "null"]}},
			required: ["token", "pr"],
			additionalProperties: false,
		});
	});

	it("puts a named part the schema uses more than once under `$defs`, where its `$ref`s point", () => {
		const Finding = Schema.Struct({file: Schema.String, line: Schema.Finite}).annotate({
			identifier: "Finding",
		});
		const schema = jsonSchema(Schema.Struct({worst: Finding, all: Schema.Array(Finding)}));

		expect(schema).toMatchObject({
			properties: {
				worst: {$ref: "#/$defs/Finding"},
				all: {type: "array", items: {$ref: "#/$defs/Finding"}},
			},
			$defs: {Finding: {type: "object", required: ["file", "line"], additionalProperties: false}},
		});
		expect(Object.keys(schema)).not.toContain("$schema");
	});

	it("reads the SDK's answer into the typed value, `null` when it does not fit, and the closing text when there is no answer", () => {
		expect(result({structured_output: {token: "DONE", pr: null}})).toMatchObject({
			type: "shell_finished",
			output: {token: "DONE", pr: null},
		});
		expect(result({structured_output: {token: "DONE"}})).toMatchObject({
			type: "shell_finished",
			output: null,
		});
		expect(result({result: 'All done. {"note": 1} {"token": "PASS", "pr": "p/7"}'})).toMatchObject({
			output: {token: "PASS", pr: "p/7"},
		});
		expect(result({result: "No object at all."})).toMatchObject({output: null});
	});

	it("may read through a schema whose two sides differ: here outside data does come in", () => {
		const counted = createDraft({
			name: "count",
			output: Schema.Struct({n: Schema.FiniteFromString}),
		});
		const finished = result({structured_output: {n: "3"}}, counted as never) as {
			output: {n: number} | null;
		};

		expect(counted.schema).toMatchObject({properties: {n: {type: "string"}}});
		expect(finished.output).toEqual({n: 3});
	});

	it("says a non-empty list as `minItems: 1` with no `prefixItems`, which Claude Code's strict check refuses; a tuple keeps it", () => {
		const Item = Schema.Struct({id: Schema.String});
		const schema = jsonSchema(
			Schema.Struct({
				ids: Schema.NonEmptyArray(Schema.String),
				deep: Schema.Array(Schema.Struct({items: Schema.NonEmptyArray(Item)})),
				pair: Schema.Tuple([Schema.String, Schema.Finite]),
			}),
		);

		expect(schema).toMatchObject({
			properties: {
				ids: {type: "array", items: {type: "string"}, minItems: 1},
				deep: {items: {properties: {items: {type: "array", minItems: 1}}}},
				pair: {prefixItems: [{type: "string"}, {type: "number"}]},
			},
		});
		expect(JSON.stringify(schema).match(/prefixItems/g)).toHaveLength(1);
		expect(Option.isNone(reader(Schema.NonEmptyArray(Schema.String))([]))).toBe(true);
	});

	it("reads `Schema.Number` as JSON cannot carry it, so an answer's numbers are `Schema.Finite`", () => {
		expect(jsonSchema(Schema.Struct({n: Schema.Finite}))).toMatchObject({
			properties: {n: {type: "number"}},
		});
		expect(jsonSchema(Schema.Struct({n: Schema.Number}))).toMatchObject({
			properties: {
				n: {anyOf: [{type: "number"}, {type: "string", enum: ["Infinity", "-Infinity", "NaN"]}]},
			},
		});
		expect(Option.getOrNull(reader(Schema.Struct({n: Schema.Finite}))({n: 1}))).toEqual({n: 1});
		expect(Option.isNone(reader(Schema.Struct({n: Schema.Finite}))({n: "NaN"}))).toBe(true);
	});
});
