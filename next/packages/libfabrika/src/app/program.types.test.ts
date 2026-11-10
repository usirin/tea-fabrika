// T280, next/: authoring depends on libfabrika and tea alone. tsc checks the uncalled cases.
import {Cmd, Machine} from "@demlik/tea/effect";
import {expect, it} from "@effect/vitest";
import {Input, Program, ProgramLoader, Write} from "@kampus/libfabrika";
import {Effect, Schema, type SchemaIssue} from "effect";
import * as fc from "fast-check";
import {expectTypeOf} from "vitest";

const Model = Schema.Struct({count: Schema.Int});

const Msg = Schema.Union([
	Schema.Struct({type: Schema.Literal("add"), n: Schema.Int}),
	Schema.Struct({type: Schema.Literal("reset")}),
]);

const save = Cmd.make("save", {
	input: Schema.Struct({count: Schema.Int}),
	ok: Schema.Struct({stored: Schema.Int}),
	err: ["disk"],
});

const machine = Machine.make({
	model: Model,
	msg: Msg,
	cmds: [save],
	init: (loaded) => [loaded ?? {count: 0}, []],
	update: {
		add: (s, m) => [{count: s.count + m.n}, [save({count: s.count + m.n})]],
		reset: () => [{count: 0}, []],
		save_ok: (s, m) => [{count: m.value.stored + s.count}, []],
		save_err: (s) => [s, []],
	},
});

const fields = {
	name: "scratch",
	machine,
	state: {v: 1, upgrades: []},
	refuse: () => null,
	inputs: {add: "Add", reset: "Reset"},
	outputs: {count: Schema.Int},
	writes: {saved: {schema: Schema.TaggedStruct("saved", {count: Schema.Int}), personOnly: false}},
	wake: () => null,
};

it("a from-scratch libfabrika program compiles and loads with a real Cmd and no app import", () => {
	fc.assert(
		fc.property(fc.integer(), (count) => {
			const p = Program.make({...fields, view: (m) => ({total: m.count})});
			expectTypeOf(p.machine).toEqualTypeOf(machine);
			expectTypeOf(p.machine.init(null, {})[0]).toEqualTypeOf<typeof Model.Type>();
			expectTypeOf(p.machine.init(null, {})[1][0]!).toEqualTypeOf<ReturnType<typeof save>>();
			expectTypeOf(p.msg.Type).toEqualTypeOf<typeof Msg.Type>();
			expectTypeOf(p.state.schema.Type).toEqualTypeOf<typeof Model.Type>();
			expectTypeOf(p.view.select({count: 1})).toEqualTypeOf<{total: number}>();
			expectTypeOf(p.inputs.add.schema.Type).toEqualTypeOf<typeof Msg.Type>();
			expectTypeOf(p.outputs.count.Type).toEqualTypeOf<number>();
			expectTypeOf(p.writes.saved.schema.Type).toEqualTypeOf<{
				readonly _tag: "saved";
				readonly count: number;
			}>();
			const ok = p.machine.update.save_ok({count: 1}, save.ok(save({count: 1}), {stored: 1}, 1));
			const err = p.machine.update.save_err(
				{count: 1},
				save.err(save({count: 1}), {_tag: "disk"}, 1),
			);
			expectTypeOf(ok[0]).toEqualTypeOf<typeof Model.Type>();
			expectTypeOf(err[1][0]!).toEqualTypeOf<ReturnType<typeof save>>();
			expectTypeOf(Program.makeEffect({...fields, view: (m) => ({total: m.count})})).toExtend<
				Effect.Effect<unknown, SchemaIssue.Issue>
			>();
			expectTypeOf<
				Effect.Error<ReturnType<typeof Program.makeEffect>>
			>().toEqualTypeOf<SchemaIssue.Issue>();
			const loaded = Effect.runSync(
				Effect.gen(function* () {
					return yield* (yield* ProgramLoader).load("scratch");
				}).pipe(Effect.provide(ProgramLoader.layer({scratch: p}, {}))),
			);
			const boot = loaded.stepper.init({count});
			expectTypeOf(boot).toExtend<{readonly _tag: "stepped" | "refused"}>();
			expect(boot).toMatchObject({_tag: "stepped", model: {count}, view: {total: count}});
		}),
		{seed: 119120, numRuns: 100},
	);
});

it("tea exposes the original schemas with readonly fields and a plain Msg, excluding Cmd replies", () => {
	expectTypeOf(machine.model).toEqualTypeOf<Schema.Schema<typeof Model.Type>>();
	expectTypeOf(machine.msg).toEqualTypeOf<Schema.Schema<typeof Msg.Type>>();
});

// Every rejection has a valid neighbor. This function is never called, even by Vitest.
function authoringTypeErrors() {
	const base = {...fields, view: (m: typeof Model.Type) => m};
	Program.make({...fields, view: (m) => ({count: m.count})});
	Program.make({
		...fields,
		view: (m) => {
			// @ts-expect-error The model comes from the machine, not this callback.
			return {count: m.missing};
		},
	});
	// @ts-expect-error Another model's selector cannot widen the machine's model.
	Program.make({...fields, view: (m: {other: string}) => ({other: m.other})});
	Program.make({...fields, view: (m) => ({count: m.count, nested: [true, null, "ok"]})});
	// @ts-expect-error A view must be JSON, not a function.
	Program.make({...fields, view: () => () => 1});
	// @ts-expect-error A nested non-JSON value is not a view either.
	Program.make({...fields, view: () => ({value: 1n})});

	Program.make({...fields, view: (m) => m, inputs: {add: "Add"}});
	Program.make({...base, inputs: {reset: {description: "Reset", personOnly: true}}});
	// @ts-expect-error A write port must name a fresh Msg case.
	Program.make({...fields, view: (m) => m, inputs: {missing: "Missing"}});
	// @ts-expect-error Settled Cmd replies are not fresh Msg ports.
	Program.make({...fields, view: (m) => m, inputs: {save_ok: "Reply"}});
	const wrongPayload = {
		description: "Add",
		schema: Schema.Struct({type: Schema.Literal("reset")}),
		personOnly: true,
	};
	// @ts-expect-error Write payload schemas come from the machine and cannot be repeated or mismatched.
	Program.make({...base, inputs: {add: wrongPayload}});
	// @ts-expect-error Write descriptions must be text.
	Program.make({...fields, view: (m) => m, inputs: {add: 3}});

	Program.make({
		...fields,
		view: (m) => m,
		refuse: (m, msg) =>
			msg.type === "add" && m.count + msg.n > 10 ? {why: "limit", now: m.count, most: 10} : null,
	});
	// @ts-expect-error Refusal parameters cannot replace the machine's fresh Msg.
	Program.make({...fields, view: (m) => m, refuse: (_m, _msg: {type: "other"}) => null});
	// @ts-expect-error Refusal parameters cannot replace the machine's model.
	Program.make({...fields, view: (m) => m, refuse: (_m: {other: number}) => null});
	// @ts-expect-error A refusal's why is text.
	Program.make({...fields, view: (m) => m, refuse: () => ({why: 3})});
	// @ts-expect-error Refusal is synchronous.
	Program.make({...fields, view: (m) => m, refuse: () => Promise.resolve(null)});

	Program.make({...fields, view: (m) => m, wake: (m) => m.count + 100});
	// @ts-expect-error Wake parameters cannot widen the model.
	Program.make({...fields, view: (m) => m, wake: (_m: {other: number}) => null});
	// @ts-expect-error Wake returns a number or null.
	Program.make({...fields, view: (m) => m, wake: () => "later"});
	// @ts-expect-error Wake is synchronous.
	Program.make({...fields, view: (m) => m, wake: () => Promise.resolve(100)});

	Program.make({
		...fields,
		view: (m) => m,
		state: {v: 2, upgrades: [{name: "count", from: 1, run: () => ({count: 0})}]},
	});
	// @ts-expect-error The state schema is filled from machine.model.
	Program.make({...fields, view: (m) => m, state: {v: 1, upgrades: [], schema: Model}});
	// @ts-expect-error The fresh Msg schema is filled from machine.msg.
	Program.make({...fields, view: (m) => m, msg: Msg});

	Program.make({
		...fields,
		view: (m) => ({total: m.count}),
		inputs: {
			count: Input.cases.read.make({
				schema: Schema.Struct({offset: Schema.Int}),
				description: "Read count",
				answer: (v: {total: number}, q) => {
					expectTypeOf(q).toEqualTypeOf<{readonly offset: number}>();
					return v.total + q.offset;
				},
			}),
		},
	});
	const wrongView = Input.cases.read.make({
		schema: Schema.Null,
		description: "Read",
		answer: (v: {other: string}) => v.other,
	});
	// @ts-expect-error A read answer takes the inferred view, not another view.
	Program.make({...base, inputs: {count: wrongView}});
	Input.cases.read.make({
		schema: Schema.Int,
		description: "Read",
		// @ts-expect-error A read answer takes its query's decoded type.
		answer: (_v: typeof Model.Type, q: string) => q,
	});
	Input.cases.read.make({schema: Schema.Null, description: "Read", answer: () => null});
	Input.cases.read.make({
		schema: Schema.Null,
		description: "Read",
		answer: () => null,
		// @ts-expect-error A read port cannot also be person-only.
		personOnly: true,
	});
	Input.cases.write.make({schema: Msg, description: "Write", personOnly: false});
	Input.cases.write.make({
		schema: Msg,
		description: "Write",
		personOnly: false,
		// @ts-expect-error A write port has no read answer.
		answer: () => null,
	});

	Program.make({
		...fields,
		view: (m) => m,
		writes: {saved: {schema: Schema.TaggedStruct("saved", {count: Schema.Int}), personOnly: true}},
	});
	const wrongTag = {schema: Schema.TaggedStruct("answered", {}), personOnly: false};
	// @ts-expect-error A fact's tag must match its policy key.
	Program.make({...base, writes: {saved: wrongTag}});
	const noTag = {schema: Schema.Struct({count: Schema.Int}), personOnly: false};
	// @ts-expect-error A fact needs its tag.
	Program.make({...base, writes: {saved: noTag}});
	const noPolicy = {schema: Schema.TaggedStruct("saved", {})};
	// @ts-expect-error A fact policy needs personOnly.
	Program.make({...base, writes: {saved: noPolicy}});
	Program.make({...fields, view: (m) => m, outputs: {count: Schema.Int}});
	// @ts-expect-error An output needs a schema.
	Program.make({...fields, view: (m) => m, outputs: {count: 3}});
	Write.cases.own.make({fact: {_tag: "saved"}});
	Write.cases.caused.make({
		parent: Schema.decodeUnknownSync(Write.cases.caused.fields.parent)(
			"in-process_01jc9q4w7z3m8n5r2t6v0xkb4d-1",
		),
		fact: {_tag: "saved"},
	});
	// @ts-expect-error A caused write must name its parent.
	Write.cases.caused.make({fact: {_tag: "saved"}});

	expectTypeOf(machine.model).toEqualTypeOf<Schema.Schema<typeof Model.Type>>();
	// @ts-expect-error Schema fields on the tea machine are readonly.
	machine.model = Model;
	// @ts-expect-error Schema fields on the tea machine are readonly.
	machine.msg = Msg;
	const fresh: typeof machine.msg.Type = {type: "add", n: 1};
	expectTypeOf(fresh).toExtend<typeof Msg.Type>();
	// @ts-expect-error The exposed msg schema excludes settled replies.
	const reply: typeof machine.msg.Type = save.ok(save({count: 1}), {stored: 1}, 1);
	return reply;
}

void authoringTypeErrors;
