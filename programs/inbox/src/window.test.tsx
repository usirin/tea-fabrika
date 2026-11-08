import {createElement, type ComponentType} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {messageRow, personRow, stopRow} from "../../../fixtures/inbox/cases.ts";
import {
	commandSubject,
	fold,
	inboxSubject,
	project,
	renderer,
	type ViewProps,
} from "../../../fixtures/inbox/subject.ts";

describe("today's inbox view laws", () => {
	it("I5: reply typing does not dispatch j, r, o, Space or Shift+O", async () => {
		const {program} = await inboxSubject("I5");
		const {commandsOf, commandFor} = await commandSubject("I5");
		const rows = commandsOf(program);
		expect(rows.some((r) => r.id === "inbox.open")).toBe(true);
		for (const key of ["j", "r", "o", " ", "O"]) {
			const press = {key, shift: key === "O", ctrl: false, meta: false, alt: false};
			expect(commandFor(rows, press, true), `typing ${key} must stay text`).toBeUndefined();
		}
		expect(
			commandFor(rows, {key: "O", shift: true, ctrl: false, alt: false, meta: false}, false)?.send,
		).toEqual({type: "open", value: null});
	});

	it.each(["window", "glance"] as const)(
		"I16: %s draws stop details without answer actions",
		async (name) => {
			const {machine, tile, glance} = await inboxSubject("I16");
			const component = await renderer<ComponentType<ViewProps>>(name, "I16");
			const state = fold(machine, [
				{type: "arrive", row: stopRow},
				{type: "select", value: stopRow.key},
				{type: "look", value: null},
			]).state;
			const html = renderToStaticMarkup(
				createElement(component, {
					view: project(name === "window" ? tile : glance, state),
					send: () => {},
				}),
			);
			expect(html).toContain("read_failed");
			expect(html).toContain("build");
			expect(html).not.toMatch(/Take rec|Every pick|Against|aria-label="Answer/);
		},
	);

	it.each(["window", "glance"] as const)(
		"I20: %s uses named grid rows with the reply inside its row",
		async (name) => {
			const {machine, tile, glance} = await inboxSubject("I20");
			const component = await renderer<ComponentType<ViewProps>>(name, "I20");
			const state = fold(machine, [
				{type: "arrive", row: stopRow},
				{type: "arrive", row: messageRow},
				{type: "arrive", row: personRow},
				{type: "select", value: messageRow.key},
				{type: "reply", value: null},
				{type: "change", value: "Please fix it."},
			]).state;
			const html = renderToStaticMarkup(
				createElement(component, {
					view: project(name === "window" ? tile : glance, state),
					send: () => {},
				}),
			);
			expect(html).toContain('role="grid"');
			expect(html).toContain('role="rowgroup"');
			expect(html).toContain('role="row"');
			expect(html).toContain('aria-selected="true"');
			expect(html.indexOf("Your turn")).toBeLessThan(html.indexOf("Messages"));
			expect(html).toContain("scout");
			expect(html).toContain("peer");
			expect(html).toContain("Please fix it.");
			expect(html).toMatch(/>Send</);
			expect(html).toMatch(/>Cancel</);
			expect(html).not.toMatch(/role="(?:listbox|option)"/);
			expect(html).not.toMatch(/<h[1-6][^>]*>Inbox<\/h/i);
		},
	);
});
