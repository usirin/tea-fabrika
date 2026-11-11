import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import fc from "fast-check";
import { expect, it } from "vitest";
import { sealAsk } from "../../tickets/ask.ts";
import { Entry } from "../../tickets/ticket.ts";
import { boundOf, EMPTY, LaneStep, MAX_ROUNDS } from "./machine.ts";
import { fold } from "./restart.ts";

// Today's version. Review 4, finding 1. Plant already present: restore fact.ask (/sealed)
// instead of the original question identity returned by readAnswer, losing the extra round.
const { DRAFT, NOW, OWNER, AGENT } = JSON.parse(
  readFileSync(new URL("../../../../../fixtures/ask-desk/cases.json", import.meta.url), "utf8"),
);

it("a granted round survives restart after any trail, for sealed and replaced asks", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.record({ step: fc.constantFrom(...LaneStep.literals), grant: fc.boolean() }), {
        maxLength: 12,
      }),
      async (history) => {
        const before: unknown[] = history.flatMap(({ step, grant }, i) => [
          {
            type: "ended",
            run: `r-${i}`,
            stage: step,
            outcome: { kind: "done", part: false },
            carry: EMPTY,
            usd: 0,
            input: 0,
            output: 0,
            turns: 1,
          },
          {
            type: "asked",
            ask: `a-rounds_spent-${i}`,
            what: "One more round?",
            picks: ["again", "stop"],
          },
          { type: "answered", ask: `a-rounds_spent-${i}`, pick: grant ? "again" : "stop", note: "" },
        ]);

        for (const replaced of [false, true]) {
          const original = `a-rounds_spent-${history.length}`;
          const ask = await Effect.runPromise(
            sealAsk({
              ...DRAFT,
              ask: replaced ? `${original}/sealed` : original,
              ...(replaced ? { replaces: original } : {}),
              for: "rounds_spent",
              step: "build",
              what: "One more round?",
              picks: [
                { pick: "again", does: "Run one more round" },
                { pick: "stop", does: "Keep the lane stopped" },
              ],
              rec: { _tag: "none", why: "The person decides the limit" },
              evidence: { _tag: "other", text: "The retry limit was reached." },
            }),
          );
          const facts = [
            ...before,
            ...(replaced
              ? [
                  { type: "asked", ask: original, what: "One more round?", picks: ["again", "stop"] },
                  { type: "withdrawn", ask: original, why: "changed" },
                ]
              : []),
            ask,
            {
              type: "answered",
              format: 1,
              ask: ask.ask,
              answer: { _tag: "chose", pick: "again" },
              saw: ask.saw,
              via: { _tag: "chat", session: "restart-test" },
            },
          ];
          const timeline = facts.map((fact, pos) =>
            Schema.decodeUnknownSync(Entry)({
              pos: pos + 1,
              ticket: 102,
              at: NOW + pos,
              by: (fact as { type: string }).type === "answered" ? OWNER : AGENT,
              fact,
            }),
          );
          const restored = fold({ timeline, plan: null, base: null, commits: [] });
          expect(boundOf(restored.held.trail), replaced ? "replaced ask" : "sealed ask").toBe(
            MAX_ROUNDS + history.filter((row) => row.grant).length + 1,
          );
        }
      },
    ),
    { seed: 119120, numRuns: 50 },
  );
});
