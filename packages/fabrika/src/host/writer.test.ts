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

	it("reads an agent and the person it works for, and writes it back", () => {
		const a = {kind: "agent", id: "triage", for: "github:42"} as const;
		expect(writerText(a)).toBe("agent:triage for:github:42");
		expect(writerOf("agent:triage for:github:42")).toEqual(a);
	});

	it("reads a row from before the door as an agent whose person it does not say", () => {
		const w = writerOf("agent:review");
		expect(w).toEqual({kind: "agent", id: "review"});
		expect(w !== null && "for" in w).toBe(false);
	});

	it.each([
		["the ledger's own name", "ledger"],
		["a host's holder name", "host-a@1761000000000"],
		["a holder past the door", "host-a@user:owner"],
		["an agent's holder past the door", "host-a@agent:triage for:github:42"],
		["a person who works for someone", "user:owner for:github:42"],
		["an agent for nobody", "agent:triage for:"],
		["an agent with something else after it", "agent:triage by:github:42"],
		["an agent for two", "agent:triage for:a for:b"],
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
