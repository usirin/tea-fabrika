// P41 slice 1, next/: program mail's pure rules (ticket 744). The delivery ID is the dispatched
// command's child under the documented `/mail` suffix, and lands in no space the brain or a runner
// owns; a destination is permitted only by the host's closed grant for that source. The real-store
// halves of L3 and L8 are in ProgramMailTest.ts.
//
// The contract these laws pin, from the plan's Files table:
//   internal/programMail.ts: `mailId(command)` and `granted(grants, source, to)`.
//   ProgramMail.ts: `Grants`, `MailRefusal` (the closed refusal reasons) and `ProgramMailError`.
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import { PIDS } from "../Process.test-support.ts";
import { brainOnly, inRunnerSpace, inSignalSpace } from "../Process.ts";
import { type Grants, MailRefusal, ProgramMailError } from "../ProgramMail.ts";
import { granted, mailId } from "./programMail.ts";

const SEED = 119120;

/** A dispatched command's ID as the runner mints it: its process, an inbox position and an index. */
const fcCommand = fc
  .tuple(fc.constantFrom(...PIDS), fc.nat({ max: 1_000_000 }), fc.nat({ max: 64 }))
  .map(([process, pos, index]) => `${process}/${pos}/${index}`);

/** Names a host could grant, the prototype's own keys among them, so a grant is never inherited. */
const fcName = fc.oneof(
  fc.stringMatching(/^[a-z]{1,8}:[0-9]{1,2}$/),
  fc.constantFrom("__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"),
);

const fcGrants: fc.Arbitrary<Grants> = fc
  .array(fc.tuple(fcName, fc.uniqueArray(fcName, { maxLength: 4 })), { maxLength: 5 })
  .map((pairs) => {
    const grants: Record<string, ReadonlyArray<string>> = Object.create(null);

    for (const [source, targets] of pairs) {
      grants[source] = targets;
    }

    return grants;
  });

describe("P41 slice 1: program mail rules", () => {
  it("L3: a delivery ID is its command's one `/mail` child, distinct per command and outside every reserved space", () => {
    fc.assert(
      fc.property(fcCommand, fcCommand, fcName, (command, other, to) => {
        const id = mailId(command);
        expect(id, "the documented suffix on the dispatched command").toBe(`${command}/mail`);
        expect(mailId(command), "derived once: the same command gives the same ID").toBe(id);
        expect(mailId(other) === id, "two commands never share a delivery ID").toBe(other === command);
        expect(id.endsWith("/answer"), "never the runner's own answer namespace").toBe(false);
        expect(inRunnerSpace(id), "never a runner's answer or alarm letter").toBe(false);
        expect(inSignalSpace(id), "never a monitor signal").toBe(false);
        expect(brainOnly({ stream: `${to}/inbox`, id, tag: "send" }), "an ordinary inbox letter").toBe(false);
      }),
      { seed: SEED, numRuns: 200 },
    );
  });

  it("L8: a destination is permitted only when the host's closed grant for that source names it", () => {
    fc.assert(
      fc.property(fcGrants, fcName, fcName, (grants, source, to) => {
        const own = Object.hasOwn(grants, source) ? grants[source] : undefined;
        const expected = own !== undefined && own.includes(to);
        expect(granted(grants, source, to), `${source} -> ${to} in ${JSON.stringify(grants)}`).toBe(expected);
        expect(granted(grants, to, source), "a grant is one way").toBe(
          Object.hasOwn(grants, to) && (grants[to] ?? []).includes(source),
        );
      }),
      {
        seed: SEED,
        numRuns: 200,
        examples: [
          // pinned: a plain object's prototype keys are never a grant.
          [{ "a:1": ["b:1"] }, "__proto__", "b:1"],
          [{ "a:1": ["b:1"] }, "constructor", "b:1"],
        ],
      },
    );
  });

  it("L13: every typed refusal encodes as its own reason under the error's `_tag`", () => {
    fc.assert(
      fc.property(fc.constantFrom(...MailRefusal.literals, "storage" as const), (reason) => {
        const encoded = Schema.encodeUnknownSync(ProgramMailError)(new ProgramMailError({ reason }));
        expect(encoded).toMatchObject({ _tag: "ProgramMailError", reason });
        expect(Object.keys(encoded as object)).not.toContain("kind");
      }),
      { seed: SEED, numRuns: 50 },
    );
  });

  it("L13 format: other clients decode the refusal reasons by name, so the closed list is pinned exactly", () => {
    expect([...MailRefusal.literals].sort()).toEqual(
      ["bad_message", "forbidden", "id_reused", "no_name", "stale_sender"].sort(),
    );
  });
});
