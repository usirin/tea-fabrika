import { readFileSync } from "node:fs";
import { it } from "@effect/vitest";
import { Schema } from "effect";
import { describe, expect } from "vitest";
import { trustedArgs } from "./door.ts";
const { TOOK } = JSON.parse(readFileSync(new URL("../../../../fixtures/ask-desk/cases.json", import.meta.url), "utf8"));

describe("ask desk P6: the door cannot stamp an agent's answer as a person", () => {
  it.prop(
    "refuses an agent's format-1 answer for every optional needed value",
    {
      n: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 })),
      id: Schema.NonEmptyString,
    },
    ({ n, id }) => {
      for (const needed of [undefined, true, false]) {
        const fact = {
          type: "answered",
          format: 1,
          ask: "a-approve-8",
          answer: { _tag: "rec" },
          saw: `sha256:${"0".repeat(64)}`,
          via: { _tag: "window", took: TOOK },
          ...(needed === undefined ? {} : { needed }),
        };
        const args = [
          `tracker/ticket/${n}/inbox`,
          "any",
          { kind: "answered", id: "answer/a-approve-8", data: fact },
          null,
        ];
        expect(trustedArgs("append", args, { kind: "agent", id, for: "github:7" })).toMatchObject({
          ok: false,
          status: 403,
        });
        expect(trustedArgs("append", args, { kind: "user", id: "github:7" })).toMatchObject({
          ok: true,
        });
      }
    },
  );
});
