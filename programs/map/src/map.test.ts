import {type AnyProgram, envelope, fit, type ShapeSchema, shapeOf} from "@kampus/fabrika";
import {
	Answer as AsksAnswer,
	Ask as AsksAsk,
	Refused,
	Settled,
	Waiting,
} from "@kampus/pipeline/asks/ask";
import {
	Built as AsksBuilt,
	Reviewed as AsksReviewed,
	asksProgram,
	Build,
	BuildRef,
	Cleared,
	Raise,
	Revised,
	Ruling,
} from "@kampus/pipeline/asks/program";
import {agentProgram} from "@kampus/pipeline/hosted/agent";
import {Delivered, deliverProgram} from "@kampus/pipeline/hosted/deliver-program";
import {Built, buildProgram} from "@kampus/pipeline/stages/build/program";
import {TicketUrl} from "@kampus/pipeline/stages/build/ticket";
import {Ended, operateProgram, Step} from "@kampus/pipeline/stages/operate/program";
import {Planned, planProgram} from "@kampus/pipeline/stages/plan/program";
import {Filed, Reviewed, ReviewTarget, reviewProgram} from "@kampus/pipeline/stages/review/program";
import {Look} from "@kampus/pipeline/stages/ship/look";
import {
	Answer,
	Ask,
	Forget,
	Passed,
	PullRequestUrl,
	Shipped,
	shipProgram,
} from "@kampus/pipeline/stages/ship/program";
import {TicketNumber} from "@kampus/pipeline/tickets/ticket";
import {Do, STEPS, tracker} from "@tea-fabrika/tracker";
import {Effect, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {familyOf, PROGRAMS, type ProgramName, SPOTS, WIRES} from "./map.ts";

// The map's table is checked against the programs it draws: every name it gives is the name in
// `defineProgram`, every port's type is that port's schema, and every wire fits. A program that
// renames a port, or changes what one carries, fails here before the map can say something old.

const agent = agentProgram({turn: () => Effect.die("never asked"), hold: {}, say: () => {}});

const REAL: {readonly [N in ProgramName]: AnyProgram} = {
	tracker,
	plan: planProgram,
	asks: asksProgram,
	operate: operateProgram,
	build: buildProgram,
	review: reviewProgram,
	ship: shipProgram,
	deliver: deliverProgram,
	agent,
};

// Each type name the table uses, as its schema. Ship's `pr` takes a union the source does not
// export: a bare url, or review's `passed`.
const TYPES: Readonly<Record<string, ShapeSchema<any>>> = {
	Do,
	TicketNumber,
	TicketUrl,
	Planned,
	Revised,
	Reviewed: Reviewed,
	Ruling,
	Answer,
	Build,
	Cleared,
	Raise,
	AskShape: AsksAsk,
	Settled,
	Refused,
	Waiting,
	Built,
	BuildRef,
	Step,
	Ended,
	PullRequestUrl,
	ReviewTarget,
	Passed,
	Filed,
	Told: Schema.Union([PullRequestUrl, Passed]),
	Ask,
	Forget,
	Look,
	Shipped,
	Delivered,
	envelope: envelope(Schema.Unknown),
};

// The asks program's own schemas, where a name is used twice: its `reviewed`, `answer` and
// `built` are its own, not review's, ship's or build's.
const ASKS_TYPES: Readonly<Record<string, ShapeSchema<any>>> = {
	Reviewed: AsksReviewed,
	Answer: AsksAnswer,
	Built: AsksBuilt,
};

const typeOf = (program: ProgramName, type: string): ShapeSchema<any> => {
	const schema = (program === "asks" ? ASKS_TYPES[type] : undefined) ?? TYPES[type];
	if (schema === undefined) throw new Error(`no schema for ${type}`);
	return schema;
};

describe("the program map", () => {
	for (const node of Object.values(PROGRAMS)) {
		const real = REAL[node.name];
		describe(node.name, () => {
			it("has the program's own name", () => {
				expect(real.name).toBe(node.name);
			});

			it("lists its inputs and outputs by their names in defineProgram", () => {
				expect(node.ins.map((p) => p.name)).toEqual(Object.keys(real.inputs));
				expect(node.outs.map((p) => p.name)).toEqual(Object.keys(real.outputs));
			});

			it("names each port's type by the schema it carries", () => {
				const ports = [
					...node.ins.map((p) => [p, real.inputs[p.name]] as const),
					...node.outs.map((p) => [p, real.outputs[p.name]] as const),
				];
				for (const [port, declared] of ports) {
					const schema = typeOf(node.name, port.type);
					expect(
						fit({shape: shapeOf(schema)}, declared as never),
						`${node.name}.${port.name}: ${port.type}`,
					).toBe("fits");
				}
			});
		});
	}

	it("draws only wires that fit: each output's shape is its input's", () => {
		for (const wire of WIRES) {
			const [fromProgram, out] = wire.from;
			const [intoProgram, inn] = wire.into;
			const from = REAL[fromProgram].outputs[out];
			const into = REAL[intoProgram].inputs[inn];
			expect(from, `${fromProgram}.${out}`).toBeDefined();
			expect(into, `${intoProgram}.${inn}`).toBeDefined();
			expect(
				fit(from as never, into as never),
				`${fromProgram}.${out} into ${intoProgram}.${inn}`,
			).toBe("fits");
		}
	});

	it("places every one of the plan's nine steps, and no other", () => {
		expect(Object.keys(SPOTS)).toEqual([...STEPS]);
	});

	it("gives a ticket its fact family, a plan its turn, a pull request its checks", () => {
		expect([
			familyOf("TicketUrl"),
			familyOf("Planned"),
			familyOf("Passed"),
			familyOf("Step"),
		]).toEqual(["fact", "turn", "checks", "step"]);
	});
});
