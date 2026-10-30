import {defineMachine} from "@demlik/tea";
import {Effect, Schema} from "effect";
import {describe, expect, expectTypeOf, it} from "vitest";
import {defineProgram, end, kind, viewOf} from "./program.ts";
import {input, output} from "./shape.ts";
import {type InputMsgOf, readInput, type WindowProps} from "./view.ts";

// A program with a window: it declares a pure view of one machine's state, with a schema, and
// its window sends it its own inputs. Nothing here draws: the window is React, in the program's
// own package; this is what the program and a host see of it.

const count = defineMachine({
	types: {model: {} as {readonly n: number}, msg: {} as {readonly type: "plus"}, ctx: undefined},
	cmds: [],
	init: (loaded) => [loaded ?? {n: 0}, []],
	update: {plus: (s) => [{n: s.n + 1}, []]},
});

const clicks = defineProgram({
	name: "clicks",
	description: "Counts the presses of plus until done, and says the count.",
	inputs: {press: input(Schema.Literals(["plus", "done"]), "A press: plus counts one, done ends.")},
	outputs: {total: output(Schema.Int, "The count, at the end.")},
	machines: {
		count: kind({
			machine: count,
			state: Schema.Struct({n: Schema.Int}),
			parent: "main",
			options: () => ({ctx: undefined}),
			drawing: () => ({name: "count", steps: {}}),
			status: (s) => `${s.n} presses`,
		}),
	},
	view: {machine: "count", data: Schema.Struct({n: Schema.Int}), of: (s) => ({n: s.n})},
	main: ({serve, send, machines}) =>
		Effect.gen(function* () {
			const counted = yield* machines.count.get("count").start();
			yield* serve({
				press: (press) =>
					press === "plus" ? counted.dispatch({type: "plus"}).pipe(Effect.orDie) : end,
			});
			yield* send("total", counted.getState().n);
		}).pipe(Effect.scoped),
});

const plain = defineProgram({
	name: "plain",
	description: "Has no window.",
	inputs: {n: input(Schema.Int, "A number.")},
	outputs: {},
	main: () => Effect.void,
});

describe("a program's view", () => {
	it("is what the program declared, and a program with none has none", () => {
		const view = viewOf(clicks);
		expect(view?.machine).toBe("count");
		expect(view?.of({n: 2})).toEqual({n: 2});
		expect(viewOf(plain)).toBeUndefined();
	});

	it("types its window by the view's data and the program's inputs", () => {
		expectTypeOf<WindowProps<typeof clicks>["view"]>().toEqualTypeOf<{readonly n: number}>();
		expectTypeOf<InputMsgOf<typeof clicks>>().toEqualTypeOf<{
			readonly type: "press";
			readonly value: "plus" | "done";
		}>();
	});

	it("is refused when it reads no machine of the program, past the types too", () => {
		expect(() =>
			defineProgram({
				name: "lost",
				description: "Its view names a machine it does not have.",
				inputs: {},
				outputs: {},
				machines: clicks.machines,
				// @ts-expect-error: `nothing` is not one of its machines.
				view: {machine: "nothing", data: Schema.Struct({}), of: () => ({})},
				main: () => Effect.void,
			}),
		).toThrow("lost's view reads nothing, which is not one of its machines");
	});
});

describe("what a window sends", () => {
	it("is read when it names an input and its value fits", () => {
		expect(readInput(clicks, {type: "press", value: "plus"})).toEqual({
			kind: "read",
			msg: {type: "press", value: "plus"},
		});
	});

	it("is refused when it names no input, its value does not fit, or it is not one at all", () => {
		expect(readInput(clicks, {type: "stop", value: null})).toEqual({
			kind: "refused",
			why: "clicks has no input stop",
		});
		expect(readInput(clicks, {type: "toString", value: null})).toEqual({
			kind: "refused",
			why: "clicks has no input toString",
		});
		const bad = readInput(clicks, {type: "press", value: "minus"});
		expect(bad.kind === "refused" && bad.why).toMatch(/^clicks's press does not fit: /);
		expect(readInput(clicks, {type: "press", value: "plus", extra: 1}).kind).toBe("refused");
		expect(readInput(clicks, "plus").kind).toBe("refused");
	});
});
