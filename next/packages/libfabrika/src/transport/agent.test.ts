// P25 E, next/. Closed method set, including P33's read-only process.info.
import {expect, it} from "@effect/vitest";
import {Effect, Schema} from "effect";
const options = {arbitrary: {seed: 119120, runs: 100, size: 100}};

const Target = Schema.Struct({
	program: Schema.String,
	input: Schema.String,
	writes: Schema.Boolean,
	personOnly: Schema.Boolean,
});
type Rule = (method: string, target: typeof Target.Type | null) => boolean;
const allowed = [
	"initialize",
	"door.knock",
	"view.open",
	"ledger.read",
	"ledger.wait",
	"process.info",
];
const forbidden = [
	"process.start",
	"process.stop",
	"process.exit",
	"process.monitor",
	"process.demonitor",
	"window.open",
	"window.msg",
	"door.watch",
	"door.deny",
	"spans.read",
	"spans.content",
	"spans.deleteContent",
	"future.method",
];
const model: Rule = (method, target) =>
	allowed.includes(method) ||
	(method === "process.send" &&
		target !== null &&
		target.program === "notes" &&
		!target.personOnly);
const law = (rule: Rule, method: string, target: typeof Target.Type | null) => {
	for (const m of [...allowed, ...forbidden, method, "process.send"])
		expect(rule(m, target), m).toBe(model(m, target));
	expect(
		rule("process.send", {program: "notes", input: "save", writes: true, personOnly: false}),
	).toBe(true);
	expect(
		rule("process.send", {program: "counter", input: "save", writes: true, personOnly: false}),
	).toBe(false);
};
it.effect.prop(
	"L18 p64 unknown methods default to not_for_agents",
	{method: Schema.String, target: Schema.NullOr(Target)},
	({method, target}) =>
		Effect.gen(function* () {
			const {agentMay} = yield* Effect.promise(() => import("./agent.ts"));
			law(agentMay, method, target);
		}),
	options,
);
it.effect.prop(
	"L19 only declared non-person-only notes targets accept writes",
	{target: Target},
	({target}) =>
		Effect.gen(function* () {
			const {agentMay} = yield* Effect.promise(() => import("./agent.ts"));
			for (const program of [target.program, "notes", "notes:spoof", "counter"])
				for (const personOnly of [true, false])
					law(agentMay, "process.send", {...target, program, personOnly});
		}),
	options,
);
it("plant L18: default allow and ordinary dispatch first", () => {
	expect(() => law(() => true, "future.method", null)).toThrow();
});
it("plant L19: notes prefix and caller metadata supply authority", () => {
	expect(() =>
		law((m, t) => m === "process.send" && t?.program.startsWith("notes") === true, "process.send", {
			program: "notes:fake",
			input: "save",
			writes: true,
			personOnly: false,
		}),
	).toThrow();
});
