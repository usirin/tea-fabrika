// P11, next/. Program is a declaration schema; stepper exposes init/step/fold from the plan.
// Imports are inside each law so an absent planned module reports every law, not zero tests.
import {Cmd, Machine} from "@demlik/tea/effect";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Result, Schema, SchemaIssue} from "effect";
import * as fc from "fast-check";
import {ParentText} from "../coordination/index.ts";
import {ProgramLoader} from "./entry.ts";
import {Input, Program, Refusal, stepper} from "./program.ts";

const Model = Schema.Struct({count: Schema.Int, replies: Schema.Int});
type Model = typeof Model.Type;
const Msg = Schema.Union([
	Schema.Struct({type: Schema.Literal("add"), n: Schema.Int}),
	Schema.Struct({type: Schema.Literal("throw")}),
]);
const save = Cmd.make("save", {
	input: Schema.Struct({n: Schema.Int}),
	ok: Schema.Int,
	err: ["disk"],
});
const machine = Machine.make({
	model: Model,
	msg: Msg,
	cmds: [save],
	init: (loaded) => [loaded ?? {count: 0, replies: 0}, []],
	update: {
		add: (s, m) => [{...s, count: s.count + m.n}, [save({n: m.n})]],
		throw: () => {
			throw new Error("planted reducer failure");
		},
		save_ok: (s) => [{...s, replies: s.replies + 1}, []],
		save_err: (s) => [{...s, replies: s.replies + 1}, []],
	},
});
const authoring = () => ({
	name: "test-counter",
	machine,
	state: {v: 1, upgrades: []},
	view: (s: Model) => ({count: s.count}),
	refuse: (s: Model, m: typeof Msg.Type) =>
		m.type === "add" && s.count + m.n > 10 ? {reason: "limit", now: s.count, most: 10} : null,
	inputs: {},
	outputs: {},
	writes: {},
	wake: () => null,
});
const spec = () => Program.make(authoring());
const SEED = 119120;
const parameters = {seed: SEED, numRuns: 100};
const model = fc.record({count: fc.integer(), replies: fc.nat()});
const declarations = fc
	.record({
		name: fc.string({minLength: 1}),
		v: fc.integer({min: 1}),
		initial: model,
		description: fc.string(),
		personDescription: fc.string(),
		query: fc.integer(),
	})
	.map(({name, v, initial, ...data}) => {
		const modelSchema = Schema.Struct(Model.fields);
		const msgSchema = Schema.Union(Msg.members);
		return {
			...data,
			initial,
			modelSchema,
			msgSchema,
			fields: {
				...authoring(),
				name,
				state: {v, upgrades: []},
				machine: Machine.make({
					...machine,
					cmds: [save],
					model: modelSchema,
					msg: msgSchema,
					init: (loaded) => [loaded ?? initial, []],
				}),
			},
		};
	});

// Other laws use the loader so they do not choose stepper's Effect or Result API.
const load = (raw: unknown) =>
	Effect.runSync(
		Effect.gen(function* () {
			return (yield* (yield* ProgramLoader).load("test")).stepper;
		}).pipe(Effect.provide(ProgramLoader.layer({test: raw}, {}))),
	);

describe("Program.make authoring laws, next/", () => {
	it("fills the load declaration from the machine without copying or wrapping it", () => {
		fc.assert(
			fc.property(
				declarations,
				({fields, initial, modelSchema, msgSchema, description, personDescription}) => {
					const p = Program.make({
						...fields,
						inputs: {add: description, throw: {description: personDescription, personOnly: true}},
					});
					expect(p.machine).toBe(fields.machine);
					expect(fields.machine.model).toBe(modelSchema);
					expect(fields.machine.msg).toBe(msgSchema);
					expect(p.state.schema).toBe(fields.machine.model);
					expect(p.msg).toBe(fields.machine.msg);
					expect(p.view.data).toBe(Schema.Json);
					expect(p.inputs.add).toMatchObject({_tag: "write", description, personOnly: false});
					expect(p.inputs.throw).toMatchObject({
						_tag: "write",
						description: personDescription,
						personOnly: true,
					});
					expect(p.inputs.add.schema).toBe(fields.machine.msg);
					expect(p.inputs.throw.schema).toBe(fields.machine.msg);
					expect(Result.isSuccess(Schema.decodeUnknownResult(Program.schema)(p))).toBe(true);
					expect(load(p).init(null)).toMatchObject({model: initial, view: {count: initial.count}});
				},
			),
			parameters,
		);
	});
	it("checks the declaration without calling program code or running a Cmd", () => {
		fc.assert(
			fc.property(declarations, ({fields, description, query}) => {
				const calls: string[] = [];
				const never = (name: string): never => {
					calls.push(name);
					throw new Error(name);
				};
				const untouched = Machine.make({
					model: fields.machine.model,
					msg: fields.machine.msg,
					cmds: [save],
					init: () => never("init"),
					update: {
						add: () => never("update"),
						throw: () => never("update"),
						save_ok: () => never("update"),
						save_err: () => never("update"),
					},
				});
				const p = Program.make({
					...fields,
					machine: untouched,
					view: () => never("view"),
					refuse: () => never("refuse"),
					wake: () => never("wake"),
					inputs: {
						read: Input.cases.read.make({
							schema: Schema.Struct({offset: Schema.Int}),
							description,
							answer: () => never("answer"),
						}),
					},
				});
				expect(p.machine).toBe(untouched);
				expect(calls).toEqual([]);
				expect(p.inputs.read._tag).toBe("read");
				expect(p.inputs.read.description).toBe(description);
				expect(Schema.decodeUnknownSync(p.inputs.read.schema)({offset: query})).toEqual({
					offset: query,
				});
			}),
			parameters,
		);
	});
	for (const [label, broken] of [
		["empty name", fc.constant({name: ""})],
		["missing machine", fc.jsonValue().map((machine) => ({machine}))],
		["invalid version", fc.integer({max: 0}).map((v) => ({state: {v, upgrades: []}}))],
		["non-function view", fc.jsonValue().map((view) => ({view}))],
		["non-function refusal", fc.jsonValue().map((refuse) => ({refuse}))],
		["non-schema output", fc.jsonValue().map((rows) => ({outputs: {rows}}))],
	] as const)
		it(`throws for ${label}, while makeEffect reports a bare schema issue without a defect`, () => {
			fc.assert(
				fc.property(declarations, broken, ({fields}, change) => {
					// Deliberately untrusted JavaScript reaches the same constructors without a cast.
					const raw: unknown = {...fields, ...change};
					const make = Reflect.get(Program, "make");
					const makeEffect = Reflect.get(Program, "makeEffect");
					expect(() => Reflect.apply(make, Program, [raw])).toThrow();
					let checked: Effect.Effect<unknown, unknown> = Effect.void;
					expect(() => {
						checked = Reflect.apply(makeEffect, Program, [raw]);
					}).not.toThrow();
					const exit = Effect.runSyncExit(Effect.result(checked));
					expect(Exit.isSuccess(exit)).toBe(true);
					if (!Exit.isSuccess(exit)) return;
					expect(Result.isFailure(exit.value)).toBe(true);
					if (Result.isFailure(exit.value)) {
						expect(
							SchemaIssue.isIssue(exit.value.failure),
							"makeEffect must fail with the bare SchemaIssue.Issue",
						).toBe(true);
					}
				}),
				parameters,
			);
		});
	it("makeEffect also constructs and loads a valid program", () => {
		fc.assert(
			fc.property(declarations, ({fields, initial}) => {
				const p = Effect.runSync(Program.makeEffect(fields));
				expect(p.machine).toBe(fields.machine);
				expect(load(p).init(null)).toMatchObject({_tag: "stepped", model: initial});
			}),
			parameters,
		);
	});
	for (const [label, change] of [
		["initial view", fc.integer().map((n) => ({view: () => () => n}))],
		["initial wake", fc.string().map((text) => ({wake: () => text}))],
	] as const)
		it(`defers a broken ${label} to checked initialization`, () => {
			fc.assert(
				fc.property(declarations, change, ({fields}, broken) => {
					const raw: unknown = {...fields, ...broken};
					const p = Reflect.apply(Program.make, Program, [raw]);
					expect(() => load(p).init(null)).toThrowError(expect.objectContaining({reason: "load"}));
				}),
				parameters,
			);
		});
	it("rejects a model that encodes to a non-JSON value", () => {
		fc.assert(
			fc.property(declarations, fc.integer(), ({fields, initial}, n) => {
				const NonJson = Schema.Struct({count: Schema.Int, body: Schema.Unknown});
				const nonJson = Machine.make({
					model: NonJson,
					msg: Msg,
					cmds: [],
					init: () => [{count: initial.count, body: () => n}, []],
					update: {add: (s) => [s, []], throw: (s) => [s, []]},
				});
				const p = Program.make({
					...fields,
					machine: nonJson,
					view: (s) => ({count: s.count}),
					refuse: () => null,
				});
				expect(() => load(p).init(null)).toThrowError(expect.objectContaining({reason: "load"}));
			}),
			parameters,
		);
	});
	it("stepper returns a typed load failure for broken unknown declarations without throwing", () => {
		const missing = fc.constantFrom(
			"name",
			"machine",
			"state",
			"msg",
			"view",
			"refuse",
			"inputs",
			"outputs",
			"writes",
			"wake",
		);
		const malformed = fc
			.option(
				fc.oneof(
					fc.tuple(declarations, missing).map(([{fields}, field]) => {
						const raw: Record<string, unknown> = {...Program.make(fields)};
						delete raw[field];
						return raw;
					}),
					fc
						.tuple(declarations, fc.jsonValue(), fc.constantFrom("msg", "state", "view", "outputs"))
						.map(([{fields}, bad, field]) => {
							const p = Program.make(fields);
							return {
								...p,
								...(field === "state"
									? {state: {...p.state, schema: bad}}
									: field === "view"
										? {view: {...p.view, data: bad}}
										: field === "outputs"
											? {outputs: {rows: bad}}
											: {msg: bad}),
							};
						}),
					fc
						.tuple(declarations, fc.jsonValue(), fc.constantFrom("refuse", "wake", "view", "init"))
						.map(([{fields}, bad, field]) => {
							const p = Program.make(fields);
							return {
								...p,
								...(field === "init"
									? {machine: {...p.machine, init: bad}}
									: field === "view"
										? {view: {...p.view, select: bad}}
										: {[field]: bad}),
							};
						}),
				),
				{nil: null},
			)
			.map((raw) => ({bug: "generated broken declaration", raw}));
		fc.assert(
			fc.property(malformed, ({raw}) => {
				// Expect Result<Stepper, SchemaError> or Effect<Stepper, SchemaIssue.Issue>.
				// ProgramDown belongs to ProgramLoader; this failure keeps Schema's details.
				let checked: unknown;
				expect(() => {
					checked = stepper(raw);
				}).not.toThrow();
				const isLoadEffect = (u: unknown): u is Effect.Effect<unknown, unknown> =>
					Effect.isEffect(u);
				let result: Result.Result<unknown, unknown>;
				if (Result.isResult(checked)) result = checked;
				else {
					expect(isLoadEffect(checked)).toBe(true);
					if (!isLoadEffect(checked)) return;
					const exit = Effect.runSyncExit(Effect.result(checked));
					expect(Exit.isSuccess(exit)).toBe(true);
					if (!Exit.isSuccess(exit)) return;
					result = exit.value;
				}
				expect(Result.isFailure(result)).toBe(true);
				if (Result.isFailure(result)) {
					expect(Schema.isSchemaError(result.failure) || SchemaIssue.isIssue(result.failure)).toBe(
						true,
					);
				}
			}),
			{
				...parameters,
				examples: [[{bug: "null module threw ProgramDown instead of a typed failure", raw: null}]],
			},
		);
	});
});

describe("P11 program contract and p22 refusal", () => {
	for (const field of ["state", "msg", "view", "refuse", "inputs", "outputs", "writes", "wake"])
		it(`plant, omit ${field}: incomplete declarations are refused`, async () => {
			const {Program} = await import("./program.ts");
			const raw: Record<string, unknown> = {...spec()};
			delete raw[field];
			expect(() => Schema.decodeUnknownSync(Program.schema)(raw)).toThrow();
		});
	it("plant, skip declaration checks: schemas and functions are checked, not mere presence", async () => {
		const {Program} = await import("./program.ts");
		for (const broken of [
			{machine: {...machine, update: 3}},
			{state: {v: 0, schema: Model, upgrades: []}},
			{state: {v: 1, schema: {}, upgrades: []}},
			{msg: {}},
			{view: {data: Model, select: 3}},
			{refuse: 3},
			{wake: "later"},
			{outputs: {rows: {}}},
			{writes: {saved: {schema: {}, personOnly: false}}},
		])
			expect(() => Schema.decodeUnknownSync(Program.schema)({...spec(), ...broken})).toThrow();
	});
	it.effect.prop(
		"plant, let settled bypass program.msg: only fold accepts checked Cmd replies",
		{generated: Schema.Int},
		({generated}) =>
			Effect.forEach(
				[3, generated],
				(value) =>
					Effect.promise(async () => {
						const p = load(spec());
						const before = {count: 2, replies: 0};
						const ok = {type: "save_ok", cmd: save({n: value}), value, at: 42};
						const err = {type: "save_err", cmd: save({n: value}), error: {_tag: "disk"}, at: 42};
						for (const reply of [ok, err]) {
							expect(p.fold(before, reply)).toMatchObject({
								_tag: "stepped",
								model: {count: 2, replies: 1},
							});
							expect(p.step(before, reply)).toEqual({_tag: "refused", reason: "bad_msg"});
						}
						for (const reply of [
							{...ok, cmd: {type: "other", n: value}},
							{...ok, at: "42"},
							{...ok, value: "3"},
							{...err, error: {_tag: 3}},
						]) {
							expect(p.step(before, reply)).toEqual({_tag: "refused", reason: "bad_msg"});
							expect(() => p.fold(before, reply)).toThrowError(
								expect.objectContaining({_tag: "ProgramDown", reason: "saved_letter"}),
							);
						}
					}),
				{concurrency: 1, discard: true},
			),
		{arbitrary: {seed: 119120, runs: 12}},
	);
	it.effect.prop(
		"a Cmd with an async result schema cannot settle before validation finishes",
		{generated: Schema.Int},
		({generated}) =>
			Effect.forEach(
				[1, generated],
				(value) =>
					Effect.promise(async () => {
						const asyncSave = {
							...save,
							schema: {
								...save.schema,
								ok: {"~standard": {validate: (value: unknown) => Promise.resolve({value})}},
							},
						};
						const broken: unknown = {...spec(), machine: {...machine, cmds: [asyncSave]}};
						const p = load(broken);
						expect(
							p.step(
								{count: 0, replies: 0},
								{type: "save_ok", cmd: save({n: value}), value, at: 42},
							),
						).toEqual({_tag: "refused", reason: "bad_msg"});
					}),
				{concurrency: 1, discard: true},
			),
		{arbitrary: {seed: 119120, runs: 12}},
	);
	it.effect.prop(
		"a saved-state failure conforms to its error schema",
		{generated: Schema.String},
		({generated}) =>
			Effect.forEach(
				["bad", generated],
				(value) =>
					Effect.promise(async () => {
						const {ProgramDown} = await import("./program.ts");
						let error: unknown;
						try {
							load(spec()).init({count: value, replies: 0});
						} catch (thrown) {
							error = thrown;
						}
						expect(error).toMatchObject({_tag: "ProgramDown", reason: "saved_state"});
						expect(Schema.is(ProgramDown)(error)).toBe(true);
					}),
				{concurrency: 1, discard: true},
			),
		{arbitrary: {seed: 119120, runs: 12}},
	);
	it("plant, reject every declaration: a complete pure tea program loads and steps", async () => {
		const {Program} = await import("./program.ts");
		const p = load(Schema.decodeUnknownSync(Program.schema)(spec()));
		expect(p.init(null)).toMatchObject({
			_tag: "stepped",
			model: {count: 0, replies: 0},
			view: {count: 0},
			cmds: [],
			wake: null,
		});
		expect(p.step({count: 2, replies: 0}, {type: "add", n: 3})).toMatchObject({
			_tag: "stepped",
			model: {count: 5, replies: 0},
			view: {count: 5},
			cmds: [save({n: 3})],
		});
	});
	it.effect.prop(
		"plant, collapse refusals: bad_msg differs from the program's limit fields",
		{generated: Refusal},
		({generated}) =>
			Effect.forEach(
				[{reason: ""}, {reason: "limit", now: 7, most: 10}, generated],
				(refusal) =>
					Effect.promise(async () => {
						const p = load(spec());
						const before = {count: 7, replies: 0};
						expect(p.step(before, {type: "add", n: "3"})).toEqual({
							_tag: "refused",
							reason: "bad_msg",
						});
						expect(p.step(before, {type: "add", n: 4})).toEqual({
							_tag: "refused",
							reason: "limit",
							now: 7,
							most: 10,
						});
						expect(before).toEqual({count: 7, replies: 0});

						// Review 2: an empty reason is legal and must survive the real stepper too.
						const checked = load({...spec(), refuse: () => refusal});
						expect(checked.step(before, {type: "add", n: 4})).toEqual({
							_tag: "refused",
							...refusal,
						});
						expect(before).toEqual({count: 7, replies: 0});
					}),
				{concurrency: 1, discard: true},
			),
		{arbitrary: {seed: 119120, runs: 12}},
	);
	it("plant, run refusal during replay: fold applies a once-accepted letter despite today's limit", async () => {
		const p = load(spec());
		expect(p.fold({count: 9, replies: 0}, {type: "add", n: 4})).toMatchObject({
			_tag: "stepped",
			model: {count: 13, replies: 0},
			cmds: [save({n: 4})],
		});
	});
	it.effect.prop(
		"p25 plant, turn a thrown step into a refusal: ProgramDown retains its failure class",
		{generated: Model},
		({generated}) =>
			Effect.forEach(
				[{count: 0, replies: 0}, generated],
				(value) =>
					Effect.promise(async () => {
						expect(() => load(spec()).step(value, {type: "throw"})).toThrowError(
							expect.objectContaining({_tag: "ProgramDown", reason: "step"}),
						);
					}),
				{concurrency: 1, discard: true},
			),
		{arbitrary: {seed: 119120, runs: 12}},
	);
	for (const part of ["model", "view", "cmd"] as const)
		it.effect.prop(
			`p25 plant, trust the returned ${part}: a malformed pure result is ProgramDown`,
			{generated: Model.check(Schema.makeFilter((model) => model.count < 10))},
			({generated}) =>
				Effect.forEach(
					[{count: 0, replies: 0}, generated],
					(value) =>
						Effect.promise(async () => {
							const broken: unknown = {
								...spec(),
								machine: {
									...machine,
									update: {
										...machine.update,
										add: () =>
											part === "model"
												? [{count: "bad", replies: 0}, []]
												: [
														{count: 1, replies: 0},
														part === "cmd" ? [{type: "save", n: "bad"}] : [],
													],
									},
								},
								view: part === "view" ? {data: Model, select: () => ({count: "bad"})} : spec().view,
							};
							expect(() => load(broken).step(value, {type: "add", n: 1})).toThrowError(
								expect.objectContaining({_tag: "ProgramDown", reason: "step"}),
							);
						}),
					{concurrency: 1, discard: true},
				),
			{arbitrary: {seed: 119120, runs: 12}},
		);
	it.effect.prop(
		"plant, treat a saved poison letter as fresh bad_msg: folding fails closed",
		{generated: Schema.NullOr(Schema.String)},
		({generated}) =>
			Effect.forEach(
				[null, generated],
				(value) =>
					Effect.promise(async () => {
						expect(() =>
							load(spec()).fold({count: 0, replies: 0}, {type: "add", n: value}),
						).toThrowError(expect.objectContaining({_tag: "ProgramDown", reason: "saved_letter"}));
					}),
				{concurrency: 1, discard: true},
			),
		{arbitrary: {seed: 119120, runs: 12}},
	);
	it("plant, give read ports write fields: read and write declarations are exclusive", async () => {
		const {Input} = await import("./program.ts");
		const decode = Schema.decodeUnknownSync(Input);
		expect(
			decode({
				_tag: "read",
				schema: Schema.Null,
				description: "Read count",
				answer: (v: unknown) => v,
			}),
		).toMatchObject({_tag: "read"});
		expect(
			decode({_tag: "write", schema: Msg, description: "Add", personOnly: false}),
		).toMatchObject({_tag: "write", personOnly: false});
		expect(() =>
			decode({_tag: "read", schema: Msg, description: "bad", personOnly: true}),
		).toThrow();
		expect(() =>
			decode({
				_tag: "write",
				schema: Msg,
				description: "bad",
				personOnly: false,
				answer: () => null,
			}),
		).toThrow();
	});
	it.effect.prop(
		"plant, synthesize a parent: Write requires caused.parent or explicit own",
		{generated: Schema.String.check(Schema.makeFilter((s) => !Schema.is(ParentText)(s)))},
		({generated}) =>
			Effect.forEach(
				["forged", generated],
				(value) =>
					Effect.promise(async () => {
						const {Write} = await import("./program.ts");
						const decode = Schema.decodeUnknownSync(Write);
						expect(decode({_tag: "own", event: {_tag: "polled", changed: false}})).toMatchObject({
							_tag: "own",
						});
						expect(() => decode({_tag: "caused", event: {_tag: "saved"}})).toThrow();
						expect(() => decode({_tag: "caused", parent: value, event: {_tag: "saved"}})).toThrow();
					}),
				{concurrency: 1, discard: true},
			),
		{arbitrary: {seed: 119120, runs: 12}},
	);
});

describe("P34 a program sets its own maxDeliveries, next/", () => {
	// The declaration takes an optional limit, an integer 1 to 32. The default (3) is the wiring's.
	const withLimit = (fields: object, maxDeliveries: unknown): unknown => ({
		...fields,
		maxDeliveries,
	});
	const refused = (raw: unknown) => {
		const make = Reflect.get(Program, "make");
		const makeEffect = Reflect.get(Program, "makeEffect");
		expect(() => Reflect.apply(make, Program, [raw])).toThrow();
		const exit = Effect.runSyncExit(Effect.result(Reflect.apply(makeEffect, Program, [raw])));
		expect(Exit.isSuccess(exit) && Result.isFailure(exit.value)).toBe(true);
	};

	it("p80 plant, drop or invent the program's limit: a generated limit 1 to 32 survives make, decode and load, and none stays none", () => {
		fc.assert(
			fc.property(
				declarations,
				fc.option(fc.integer({min: 1, max: 32}), {nil: undefined}),
				({fields}, limit) => {
					const raw = limit === undefined ? fields : withLimit(fields, limit);
					const own = (u: unknown) =>
						typeof u === "object" && u !== null && Object.hasOwn(u, "maxDeliveries")
							? Reflect.get(u, "maxDeliveries")
							: undefined;
					const p: unknown = Reflect.apply(Reflect.get(Program, "make"), Program, [raw]);
					expect(own(p)).toBe(limit);
					const decoded = Schema.decodeUnknownResult(Program.schema)(p);
					expect(Result.isSuccess(decoded)).toBe(true);
					if (Result.isSuccess(decoded)) expect(own(decoded.success)).toBe(limit);
					expect(own(load(p).program)).toBe(limit);
					const effect: unknown = Effect.runSync(
						Reflect.apply(Reflect.get(Program, "makeEffect"), Program, [raw]),
					);
					expect(own(effect)).toBe(limit);
				},
			),
			{...parameters, examples: [[fc.sample(declarations, {seed: SEED, numRuns: 1})[0]!, 7]]},
		);
	});

	it("p80 plant, accept any limit: 0, 33, 1.5 and every generated value outside 1 to 32 fail to decode", () => {
		fc.assert(
			fc.property(
				declarations,
				fc.oneof(
					fc.integer({max: 0}),
					fc.integer({min: 33}),
					fc.double({min: 1, max: 32, noNaN: true}).filter((n) => !Number.isInteger(n)),
					fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, "3", null),
				),
				({fields}, limit) => {
					refused(withLimit(fields, limit));
					const checked = withLimit(Program.make(fields), limit);
					expect(Result.isFailure(Schema.decodeUnknownResult(Program.schema)(checked))).toBe(true);
					expect(Result.isFailure(stepper(checked))).toBe(true);
				},
			),
			{
				...parameters,
				// The amendment's three named values.
				examples: [
					[fc.sample(declarations, {seed: SEED, numRuns: 1})[0]!, 0],
					[fc.sample(declarations, {seed: SEED, numRuns: 1})[0]!, 33],
					[fc.sample(declarations, {seed: SEED, numRuns: 1})[0]!, 1.5],
				],
			},
		);
	});
});
