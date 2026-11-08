import {describe, expect, it} from "vitest";
import {messageRow, personRow} from "../../../../fixtures/inbox/cases.ts";
import {fold, inboxSubject, step} from "../../../../fixtures/inbox/subject.ts";

describe("today's D3 look", () => {
	it("I15: Space opens the selected look, selection moves it, and Space or Escape closes it", async () => {
		const {machine, tile} = await inboxSubject("I15");
		const initial = fold(machine, [
			{type: "arrive", row: messageRow},
			{type: "arrive", row: personRow},
			{type: "select", value: messageRow.key},
		]).state;
		const [opened, cmds] = step(machine, initial, {type: "look", value: null});
		expect(tile.of(opened)).toMatchObject({look: true, selected: messageRow.key});
		expect(cmds.filter((c) => c.type === "open_program" || c.type === "focus")).toEqual([]);
		const [moved] = step(machine, opened, {type: "move", value: 1});
		expect(tile.of(moved)).toMatchObject({look: true, selected: personRow.key});
		const [spaceClosed] = step(machine, moved, {type: "look", value: null});
		expect(spaceClosed.look).toBe(false);
		const [escapeClosed] = step(machine, moved, {type: "escape", value: null});
		expect(escapeClosed.look).toBe(false);
		expect(escapeClosed.selected).toBe(personRow.key);
	});
});
