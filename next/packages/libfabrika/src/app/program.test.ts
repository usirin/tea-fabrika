// P11, next/. Program is a declaration schema; stepper exposes init/step/fold from the plan.
// Imports are inside each law so an absent planned module reports every law, not zero tests.
import {Cmd, Machine} from "@demlik/tea/effect";
import {describe, expect, it} from "@effect/vitest";
import {Schema} from "effect";

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
const spec = () => ({
	name: "test-counter",
	machine,
	state: {v: 1, schema: Model, upgrades: []},
	msg: Msg,
	view: {data: Schema.Struct({count: Schema.Int}), select: (s: Model) => ({count: s.count})},
	refuse: (s: Model, m: typeof Msg.Type) =>
		m.type === "add" && s.count + m.n > 10 ? {why: "limit", now: s.count, most: 10} : null,
	inputs: {},
	outputs: {},
	writes: {},
	wake: () => null,
});

describe("P11 program contract and p22 refusal", () => {
	for (const field of ["state", "msg", "view", "refuse", "inputs", "outputs", "writes", "wake"])
		it(`plant, omit ${field}: incomplete declarations are refused`, async () => {
			const {Program} = await import("./program.ts");
			const raw: Record<string, unknown> = {...spec()};
			delete raw[field];
			expect(() => Schema.decodeUnknownSync(Program)(raw)).toThrow();
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
			expect(() => Schema.decodeUnknownSync(Program)({...spec(), ...broken})).toThrow();
	});
	it("plant, let settled bypass program.msg: only fold accepts checked Cmd replies", async () => {
		const {stepper} = await import("./program.ts");
		const p = stepper(spec());
		const before = {count: 2, replies: 0};
		const ok = {type: "save_ok", cmd: save({n: 3}), value: 3, at: 42};
		const err = {type: "save_err", cmd: save({n: 3}), error: {_tag: "disk"}, at: 42};
		for (const reply of [ok, err]) {
			expect(p.fold(before, reply)).toMatchObject({
				_tag: "stepped",
				model: {count: 2, replies: 1},
			});
			expect(p.step(before, reply)).toEqual({_tag: "refused", why: "bad_msg"});
		}
		for (const reply of [
			{...ok, cmd: {type: "other", n: 3}},
			{...ok, at: "42"},
			{...ok, value: "3"},
			{...err, error: {_tag: 3}},
		]) {
			expect(p.step(before, reply)).toEqual({_tag: "refused", why: "bad_msg"});
			expect(() => p.fold(before, reply)).toThrowError(
				expect.objectContaining({_tag: "ProgramDown", why: "saved_letter"}),
			);
		}
	});
	it("a Cmd with an async result schema cannot settle before validation finishes", async () => {
		const {stepper} = await import("./program.ts");
		const asyncSave = {
			...save,
			schema: {
				...save.schema,
				ok: {"~standard": {validate: (value: unknown) => Promise.resolve({value})}},
			},
		};
		const p = stepper({...spec(), machine: {...machine, cmds: [asyncSave]}});
		expect(
			p.step({count: 0, replies: 0}, {type: "save_ok", cmd: save({n: 1}), value: 1, at: 42}),
		).toEqual({_tag: "refused", why: "bad_msg"});
	});
	it("a saved-state failure conforms to its error schema", async () => {
		const {ProgramDown, stepper} = await import("./program.ts");
		let error: unknown;
		try {
			stepper(spec()).init({count: "bad", replies: 0});
		} catch (thrown) {
			error = thrown;
		}
		expect(error).toMatchObject({_tag: "ProgramDown", why: "saved_state"});
		expect(Schema.is(ProgramDown)(error)).toBe(true);
	});
	it("plant, reject every declaration: a complete pure tea program loads and steps", async () => {
		const {Program, stepper} = await import("./program.ts");
		const p = stepper(Schema.decodeUnknownSync(Program)(spec()));
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
	it("plant, collapse refusals: bad_msg differs from the program's limit fields", async () => {
		const {stepper} = await import("./program.ts");
		const p = stepper(spec());
		const before = {count: 7, replies: 0};
		expect(p.step(before, {type: "add", n: "3"})).toEqual({_tag: "refused", why: "bad_msg"});
		expect(p.step(before, {type: "add", n: 4})).toEqual({
			_tag: "refused",
			why: "limit",
			now: 7,
			most: 10,
		});
		expect(before).toEqual({count: 7, replies: 0});
	});
	it("plant, run refusal during replay: fold applies a once-accepted letter despite today's limit", async () => {
		const {stepper} = await import("./program.ts");
		const p = stepper(spec());
		expect(p.fold({count: 9, replies: 0}, {type: "add", n: 4})).toMatchObject({
			_tag: "stepped",
			model: {count: 13, replies: 0},
			cmds: [save({n: 4})],
		});
	});
	it("p25 plant, turn a thrown step into a refusal: ProgramDown retains its failure class", async () => {
		const {stepper} = await import("./program.ts");
		expect(() => stepper(spec()).step({count: 0, replies: 0}, {type: "throw"})).toThrowError(
			expect.objectContaining({_tag: "ProgramDown", why: "step"}),
		);
	});
	for (const part of ["model", "view", "cmd"] as const)
		it(`p25 plant, trust the returned ${part}: a malformed pure result is ProgramDown`, async () => {
			const {stepper} = await import("./program.ts");
			const broken = {
				...spec(),
				machine: {
					...machine,
					update: {
						...machine.update,
						add: () =>
							part === "model"
								? [{count: "bad", replies: 0}, []]
								: [{count: 1, replies: 0}, part === "cmd" ? [{type: "save", n: "bad"}] : []],
					},
				},
				view: part === "view" ? {data: Model, select: () => ({count: "bad"})} : spec().view,
			};
			expect(() => stepper(broken).step({count: 0, replies: 0}, {type: "add", n: 1})).toThrowError(
				expect.objectContaining({_tag: "ProgramDown", why: "step"}),
			);
		});
	it("plant, treat a saved poison letter as fresh bad_msg: folding fails closed", async () => {
		const {stepper} = await import("./program.ts");
		expect(() => stepper(spec()).fold({count: 0, replies: 0}, {type: "add", n: null})).toThrowError(
			expect.objectContaining({_tag: "ProgramDown", why: "saved_letter"}),
		);
	});
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
	it("plant, synthesize a parent: Write requires caused.parent or explicit own", async () => {
		const {Write} = await import("./program.ts");
		const decode = Schema.decodeUnknownSync(Write);
		expect(decode({_tag: "own", fact: {_tag: "polled", changed: false}})).toMatchObject({
			_tag: "own",
		});
		expect(() => decode({_tag: "caused", fact: {_tag: "saved"}})).toThrow();
		expect(() => decode({_tag: "caused", parent: "forged", fact: {_tag: "saved"}})).toThrow();
	});
});
