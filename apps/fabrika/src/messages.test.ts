import {describe, expect, it} from "vitest";
import {readFromPage, readToPage} from "./messages.ts";

// The envelope of each message type, read strictly. What is inside `msg` is read by its run's
// program, in host.test.ts.

describe("a message from the page", () => {
	it("reads when it names the pane and a run", () => {
		const m = {type: "msg", pane: "p1", to: "tsh:p1", msg: {type: "line", value: "seq --to 3"}};
		expect(readFromPage(m)).toEqual({kind: "read", msg: m});
	});

	it("is refused for another pane, with a key it does not name, or with no run", () => {
		const m = {type: "msg", pane: "p1", to: "tsh:p1", msg: null};
		expect(readFromPage({...m, pane: "p9"}).kind).toBe("refused");
		expect(readFromPage({...m, extra: true}).kind).toBe("refused");
		expect(readFromPage({type: "msg", pane: "p1", msg: null}).kind).toBe("refused");
		expect(readFromPage("seq --to 3").kind).toBe("refused");
	});
});

describe("a view to the page", () => {
	it("reads with tsh and its fronts, and is refused with a line of no kind it knows", () => {
		const view = {
			type: "view",
			pane: "p1",
			data: {
				tsh: {
					run: "tsh:p1",
					lines: [{kind: "typed", text: "counter"}],
					state: {kind: "busy", waiting: 1},
				},
				front: [{program: "counter", run: "c:1", data: {n: 0}}],
			},
		};
		expect(readToPage(view)).toEqual({kind: "read", msg: view});
		const odd = {...view, data: {...view.data, tsh: {...view.data.tsh, lines: [{kind: "beep"}]}}};
		expect(readToPage(odd).kind).toBe("refused");
	});
});
