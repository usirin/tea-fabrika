import {propertyInvariant, propertyTrace} from "@demlik/tea/pbt";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	askRow,
	messageRow,
	PERSON_MESSAGE,
	personRow,
	stopRow,
} from "../../../fixtures/inbox/cases.ts";
import {
	fold,
	inboxSubject,
	type InboxMachine,
	type Msg,
	project,
} from "../../../fixtures/inbox/subject.ts";

const opts = {seed: 119120, numRuns: 80};
const motion = fc.constantFrom<Msg>(
	{type: "move", value: 1},
	{type: "move", value: -1},
	{type: "later", value: null},
	{type: "answered", key: "268/a-approve-268"},
);
const sequences = async () => {
	const ask = await askRow();
	return fc
		.array(
			fc.oneof(
				motion,
				fc.nat({max: 12}).map((n): Msg => ({
					type: "arrive",
					row: {...messageRow, key: `m${n}`, message: {...PERSON_MESSAGE, id: `m${n}`}},
				})),
			),
			{maxLength: 40},
		)
		.map((rest): readonly Msg[] => [
			{type: "arrive", row: ask},
			{type: "arrive", row: stopRow},
			{type: "arrive", row: messageRow},
			{type: "arrive", row: personRow},
			{type: "select", value: messageRow.key},
			...rest,
		]);
};

describe("today's inbox ordered laws", () => {
	it("I1: glance and tile share rows and selection through arrivals, moves, answers and Later", async () => {
		const {machine, tile, glance} = await inboxSubject("I1");
		const lists = await sequences();
		const check = (glanceView = glance) =>
			propertyInvariant(
				machine,
				undefined,
				lists,
				({prev, msg, next}) => {
					const full = project(tile, next);
					const quick = project(glanceView, next);
					expect(quick.rows).toEqual(full.rows);
					expect(quick.selected).toBe(full.selected);
					expect(full.selected).toBe(next.selected);
					expect(full.rows).toEqual(next.rows);
					expect(
						msg.type !== "arrive" || prev.selected === null || next.selected === prev.selected,
					).toBe(true);
					expect(next.selected === null || next.rows.some((r) => r.key === next.selected)).toBe(
						true,
					);
					return true;
				},
				opts,
			);
		check();
		// Plant I1: a view keeps its own, initially empty selection.
		expect(() =>
			check({...glance, of: (state) => ({...project(glance, state), selected: null})}),
		).toThrow();
	});

	it("I2: Your turn precedes Messages, including both people and agents, in received order", async () => {
		const {machine, tile} = await inboxSubject("I2");
		const ask = await askRow();
		const lists = fc
			.shuffledSubarray([messageRow, personRow, stopRow, ask], {minLength: 4, maxLength: 4})
			.map((rows): readonly Msg[] => rows.map((row) => ({type: "arrive", row})));
		const check = (on: InboxMachine) =>
			propertyTrace(
				on,
				undefined,
				lists,
				(trace, state) => {
					const rows = project(tile, state).rows;
					const received = trace.flatMap(({msg}) =>
						msg.type === "arrive" && msg.row._tag === "message" ? [msg.row.key] : [],
					);
					expect(rows.filter((r) => r._tag === "message").map((r) => r.key)).toEqual(received);
					const firstMessage = rows.findIndex((r) => r._tag === "message");
					expect(rows.slice(firstMessage).every((r) => r._tag === "message")).toBe(true);
					expect(new Set(rows.map((r) => r.key))).toEqual(
						new Set([ask.key, stopRow.key, messageRow.key, personRow.key]),
					);
					return true;
				},
				opts,
			);
		check(machine);
		// Plant I2: retain only messages from agents.
		const onlyAgents: InboxMachine = {
			...machine,
			update: {
				...machine.update,
				arrive: (s, m) => {
					if (
						m.row._tag === "message" &&
						Reflect.get(Object(Reflect.get(Object(m.row.message), "by")), "kind") === "user"
					)
						return [s, []];
					return machine.update.arrive(s, m);
				},
			},
		};
		expect(() => check(onlyAgents)).toThrow();
	});

	it("I1: a removed selection chooses next, then previous, then none", async () => {
		const {machine} = await inboxSubject("I1");
		const ask = await askRow();
		const second = await askRow(270);
		const third = await askRow(271);
		const {state} = fold(
			machine,
			[ask, second, third].map((row) => ({type: "arrive", row})),
		);
		const selected = fold(machine, [{type: "select", value: second.key}], state).state;
		const next = fold(machine, [{type: "answered", key: second.key}], selected).state;
		expect(next.selected).toBe(third.key);
		const previous = fold(machine, [{type: "answered", key: third.key}], next).state;
		expect(previous.selected).toBe(ask.key);
		const empty = fold(machine, [{type: "answered", key: ask.key}], previous).state;
		expect(empty.selected).toBeNull();
	});
});
