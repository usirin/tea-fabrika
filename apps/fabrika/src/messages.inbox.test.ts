import {describe, expect, it} from "vitest";
import {readFromPage, readToPage} from "./messages.ts";

describe("today's inbox wire", () => {
	it("I12/I17: a checked program-and-location open carries origin and command route", () => {
		const request = {
			type: "open_program",
			program: "inbox",
			location: {row: "m17"},
			from: "t1",
			via: {_tag: "key", keys: "shift+o"},
		};
		expect(readFromPage(request), "I12/I17: the wire has no program open request").toEqual({
			kind: "read",
			msg: request,
		});
		expect(readFromPage({...request, from: "../../elsewhere"}).kind).toBe("refused");
		expect(readFromPage({...request, location: {row: 17}}).kind).toBe("refused");
	});
	it("I18: one schema-checked glance choice names the chosen and effective provider", () => {
		const value = {
			type: "glance",
			choice: "tracker",
			effective: "inbox",
			offers: ["inbox"],
			why: null,
		};
		expect(readToPage(value), "I18: glance offers and fallback are absent from the wire").toEqual({
			kind: "read",
			msg: value,
		});
		expect(readToPage({...value, offers: [17]}).kind).toBe("refused");
	});
});
