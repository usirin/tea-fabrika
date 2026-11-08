import {counter} from "@tea-fabrika/counter";
import {map} from "@tea-fabrika/map";
import {markdown} from "@tea-fabrika/markdown";
import {ticket} from "@tea-fabrika/ticket";
import {trace} from "@tea-fabrika/trace";
import {tracker} from "@tea-fabrika/tracker";
import {describe, expect, it} from "vitest";
import {keysProgram} from "../keys/program.ts";

describe("today's shipped command declarations", () => {
	it.each([tracker, ticket, markdown, trace, keysProgram])(
		"P3: $name owns its existing custom shortcuts",
		(program) => {
			expect(program.commands, `${program.name}'s custom keys need declarations`).toBeDefined();
			expect(Object.keys(program.commands)).not.toHaveLength(0);
		},
	);
	it("P3: Counter and Map expose existing actions without inventing a default", () => {
		expect(counter.commands).toMatchObject({
			plus: {send: {type: "press", value: "plus"}, keys: []},
			done: {send: {type: "press", value: "done"}, keys: []},
		});
		expect(map.commands).toMatchObject({quit: {send: {type: "quit", value: null}, keys: []}});
	});
	it("P3: Markdown's local scroll is a checked window message and quits through its input", () => {
		expect(markdown.view.window).toBeDefined();
		expect(markdown.commands.quit.keys).toBe("q");
		// The controller must accept this message through its own schema, rather than the
		// shared program receiving a renderer-only scroll as an unchecked input.
		expect(markdown.view.window.msg).toBeDefined();
		expect(markdown.view.window.machine).toBeDefined();
	});
});
