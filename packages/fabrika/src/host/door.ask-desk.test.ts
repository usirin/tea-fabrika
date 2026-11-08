import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import {trustedArgs} from "./door.ts";
const {TOOK} = JSON.parse(
	readFileSync(new URL("../../../../fixtures/ask-desk/cases.json", import.meta.url), "utf8"),
);

describe("ask desk P6: the door cannot stamp an agent's answer as a person", () => {
	it.each([undefined, true, false])("refuses format-1 answered with needed=%s", (needed) => {
		const fact = {
			type: "answered",
			format: 1,
			ask: "a-approve-8",
			answer: {_tag: "rec"},
			saw: `sha256:${"0".repeat(64)}`,
			via: {_tag: "window", took: TOOK},
			...(needed === undefined ? {} : {needed}),
		};
		const args = [
			"tracker/ticket/117/inbox",
			"any",
			{kind: "answered", id: "answer/a-approve-8", data: fact},
			null,
		];
		expect(
			trustedArgs("append", args, {kind: "agent", id: "inbox", for: "github:7"}),
		).toMatchObject({ok: false, status: 403});
		expect(trustedArgs("append", args, {kind: "user", id: "github:7"})).toMatchObject({ok: true});
	});
});
