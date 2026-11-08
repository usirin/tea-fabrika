import {defineMachine} from "@demlik/tea";
import {Effect, Layer, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {listed} from "./listed.ts";
import {defineProgram, kind} from "./program.ts";
import {input} from "./shape.ts";
import type {WindowProps} from "./view.ts";

const State = Schema.Struct({mode: Schema.NullOr(Schema.Literals(["select", "search"]))});
const Msg = Schema.Union([
	Schema.Struct({type: Schema.Literal("next")}),
	Schema.Struct({type: Schema.Literal("exit")}),
]);
const local = defineMachine({
	types: {model: {} as typeof State.Type, msg: {} as typeof Msg.Type, ctx: undefined},
	cmds: [],
	init: () => [{mode: null}, []],
	update: {next: (s) => [s, []], exit: () => [{mode: null}, []]},
});
const base = {
	name: "commands-fixture",
	description: "Checks command declarations.",
	inputs: {
		act: input(Schema.String, "An action."),
		answer: input(Schema.Boolean, "A person's decision.", {personOnly: true}),
	},
	outputs: {},
	main: () => Effect.void,
};
const viewed = {
	...base,
	machines: {
		local: kind({
			machine: local,
			state: State,
			parent: "main",
			options: () => ({ctx: undefined}),
			status: () => "ready",
			drawing: () => ({name: "local", steps: {}}),
		}),
	},
	view: {
		machine: "local" as const,
		data: State,
		of: (s: typeof State.Type) => s,
		window: {machine: local, state: State, msg: Msg, refuse: () => null},
	},
	mode: (s: typeof State.Type) => s.mode,
};

describe("today's typed command declarations", () => {
	it("P1: JavaScript cannot smuggle an unrelated message through either declaration", () => {
		for (const definition of [base, viewed]) {
			expect(() =>
				defineProgram({
					...definition,
					commands: {wrong: {send: {type: "unrelated", value: 1}, keys: "j"}},
				}),
			).toThrow(/command|unrelated|message|input/i);
		}
	});
	it("P2: no modes means null, and a mode command without mode() is refused", () => {
		expect(() =>
			defineProgram({
				...base,
				commands: {copy: {send: {type: "act", value: "copy"}, keys: "c", mode: "copy"}},
			}),
		).toThrow(/mode.*copy|copy.*mode/i);
		const defined = defineProgram({
			...viewed,
			commands: {next: {send: {type: "next"}, keys: "j"}},
		});
		expect(defined.mode({mode: null})).toBeNull();
	});
	it("P31: narrowing for an agent removes person-only commands as well as inputs", () => {
		const defined = defineProgram({
			...base,
			commands: {
				act: {send: {type: "act", value: "go"}, keys: []},
				answer: {send: {type: "answer", value: true}, keys: []},
			},
		});
		const agents = listed(defined, Layer.empty).forAgent().program;
		expect(agents.inputs).not.toHaveProperty("answer");
		expect(agents.commands).toHaveProperty("act");
		expect(agents.commands).not.toHaveProperty("answer");
	});
});

// P1/P2's compiler plants: a structurally valid definition must not widen the inferred
// message or mode to accommodate a bad command. Keep the bad field inside a variable.
const _declarationTypes = () => {
	const inputOnly = {
		...base,
		commands: {
			act: {send: {type: "act" as const, value: "go"}, keys: []},
		},
	};
	defineProgram(inputOnly);
	const wrongInput = {
		...base,
		commands: {
			wrong: {send: {type: "unrelated" as const, value: 1}, keys: "j"},
		},
	};
	// @ts-expect-error P1: unrelated input must not compile.
	defineProgram(wrongInput);
	const wrongValue = {
		...base,
		commands: {
			wrong: {send: {type: "act" as const, value: 1}, keys: "j"},
		},
	};
	// @ts-expect-error P1: a known input still checks its value.
	defineProgram(wrongValue);
	const windowed = {...viewed, commands: {next: {send: {type: "next" as const}, keys: "j"}}};
	const defined = defineProgram(windowed);
	const wrongWindow = {
		...viewed,
		commands: {
			wrong: {send: {type: "act" as const, value: "host input"}, keys: "j"},
		},
	};
	// @ts-expect-error P1: a local window command takes its own Msg, not a host input.
	defineProgram(wrongWindow);
	const noModes = {
		...inputOnly,
		commands: {
			copy: {send: {type: "act" as const, value: "go"}, keys: "c", mode: "copy" as const},
		},
	};
	// @ts-expect-error P2: no mode() cannot grow a copy mode through a command.
	defineProgram(noModes);
	const wrongMode = {
		...viewed,
		commands: {
			copy: {send: {type: "next" as const}, keys: "c", mode: "copy" as const},
		},
	};
	// @ts-expect-error P2: mode() returns select, search or null, never copy.
	defineProgram(wrongMode);
	const helpers = (props: WindowProps<typeof defined>) => {
		props.commands.next();
		// @ts-expect-error P1: helpers keep the declaration's command names.
		props.commands.typo();
	};
	return helpers;
};
