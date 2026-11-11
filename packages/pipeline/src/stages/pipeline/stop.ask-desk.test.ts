import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { property } from "../../ask-desk.test-support.ts";
import { Fact } from "../../tickets/ticket.ts";
import { ROUTES } from "./routes.ts";

describe("ask desk P20: save only actual stops", () => {
  property("records both why work stopped and where it resumes", { why: Schema.NonEmptyString }, ({ why }) => {
    const fact = { type: "stopped", why, resume: "review" };
    expect(Schema.decodeUnknownSync(Fact)(fact)).toStrictEqual(fact);
    expect(Schema.is(Fact)({ type: "stopped", why })).toBe(false);
  });
  // vector: approved plan P20 fixes this route to review; its exact trigger is no_review.
  it("vector: keeps no_review on the automatic review route", () => {
    expect(ROUTES.merge["send:reviewer:no_review"]).toEqual({ _tag: "run", step: "review" });
  });
});
