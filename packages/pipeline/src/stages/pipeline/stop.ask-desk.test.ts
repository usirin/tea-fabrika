import {Schema} from "effect";
import {describe, expect, it} from "vitest";
import {Fact} from "../../tickets/ticket.ts";
import {ROUTES} from "./routes.ts";

describe("ask desk P20: save only actual stops", () => {
	it("records both why work stopped and where it resumes", () => {
		const fact = {type: "stopped", why: "read_failed", resume: "review"};
		expect(Schema.decodeUnknownSync(Fact)(fact)).toStrictEqual(fact);
		expect(Schema.is(Fact)({type: "stopped", why: "read_failed"})).toBe(false);
	});
	it("keeps no_review on the automatic review route", () => {
		expect(ROUTES.merge["send:reviewer:no_review"]).toEqual({_tag: "run", step: "review"});
	});
});
