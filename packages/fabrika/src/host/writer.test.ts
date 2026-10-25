import {describe, expect, it} from "vitest";
import {writerOf, writerText} from "./writer.ts";

describe("the writer of a row", () => {
	it("reads a user and an agent from their text", () => {
		expect(writerOf("user:owner")).toEqual({kind: "user", id: "owner"});
		expect(writerOf("agent:review")).toEqual({kind: "agent", id: "review"});
		// Split at the first colon: the rest is the id.
		expect(writerOf("agent:review:lane-12")).toEqual({kind: "agent", id: "review:lane-12"});
	});

	it("writes the text it reads back", () => {
		expect(writerText({kind: "user", id: "owner"})).toBe("user:owner");
		expect(writerOf(writerText({kind: "agent", id: "review:lane-12"}))).toEqual({
			kind: "agent",
			id: "review:lane-12",
		});
	});

	it.each([
		["the ledger's own name", "ledger"],
		["a host's holder name", "host-a@1761000000000"],
		["an empty id", "user:"],
		["an id with a space", "user:the owner"],
		["no kind", ":owner"],
		["a kind that is neither", "robot:owner"],
		["a kind in another case", "User:owner"],
		["nothing", ""],
	])("names no writer for %s, so it is never a user", (_, text) => {
		expect(writerOf(text)).toBeNull();
	});
});
