// p42: signed bytes are schema-ordered JSON for the tagged change plus one LF. These independent
// strings catch omitted tags, saw fields or reordered signing text. No crypto belongs here.
import { describe, expect, it } from "@effect/vitest";
import { Adds, type Grant } from "./Access.ts";
import { grantText, revokeText, addText, enrollmentText } from "./Text.ts";

const ADD_SAW = {
  how: "device",
  check: "touch",
  where: "test",
  has: ["verify"],
  typed: false,
  kept: null,
  old: null,
} as const;

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const SAW = {
  code: "1234",
  label: "Browser",
  where: "test",
  how: "compare",
  check: "touch",
  has: ["verify", "seal"],
} as const;

const SENT = "2026-11-08T04:00:00.000Z";
const TOOK = { label: "Browser", where: "test", how: "panel", check: "touch" } as const;

const grant = {
  id: "g1",
  key: "window",
  for: PERSON,
  to: "project-a",
  as: "window",
  saw: SAW,
  sentAt: SENT,
} satisfies typeof Grant.Type;

const revoke = { id: "r1", key: "window", for: PERSON, to: "project-a", saw: TOOK, sentAt: SENT };

const add = {
  id: "a1",
  for: PERSON,
  to: "project-a",
  adds: Adds.cases.person.make({ key: "person-key", window: "window" }),
  drops: [],
  saw: ADD_SAW,
  sentAt: SENT,
};

describe("P10 signed text", () => {
  it("format: grantText: tag, target, every saw field and one newline are signed", () => {
    expect(grantText(grant)).toBe(
      `{"_tag":"granted","grant":{"id":"g1","key":"window","for":"${PERSON}","to":"project-a","as":"window","saw":{"code":"1234","label":"Browser","where":"test","how":"compare","check":"touch","has":["verify","seal"]},"sentAt":"${SENT}"}}\n`,
    );
  });
  it("format: revokeText: removal has its own tag and complete saw", () => {
    expect(revokeText(revoke)).toBe(
      `{"_tag":"revoked","revoke":{"id":"r1","key":"window","for":"${PERSON}","to":"project-a","saw":{"label":"Browser","where":"test","how":"panel","check":"touch"},"sentAt":"${SENT}"}}\n`,
    );
  });
  it("format: addText: the new root, window and complete recovery observation are signed", () => {
    expect(addText(add)).toBe(
      `{"_tag":"added","add":{"id":"a1","for":"${PERSON}","to":"project-a","adds":{"_tag":"person","key":"person-key","window":"window"},"drops":[],"saw":{"how":"device","check":"touch","where":"test","has":["verify"],"typed":false,"kept":null,"old":null},"sentAt":"${SENT}"}}\n`,
    );
  });
  it("format: enrollmentText: proof binds both keys, person, ledger, add id and nonce", () => {
    const value = {
      id: "a1",
      to: "project-a",
      for: PERSON,
      key: "sk-key",
      window: "window",
      nonce: "n1",
    };
    const text = enrollmentText(value);
    expect(text).toBe(
      `{"_tag":"enrolled","id":"a1","to":"project-a","for":"${PERSON}","key":"sk-key","window":"window","nonce":"n1"}\n`,
    );

    for (const name of ["id", "to", "for", "key", "window", "nonce"] as const) {
      expect(enrollmentText({ ...value, [name]: "changed" })).not.toBe(text);
    }
  });
});
