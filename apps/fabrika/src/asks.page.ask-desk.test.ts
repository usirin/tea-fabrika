import { applyCell } from "@demlik/tea";
import type { MsgOf } from "@kampus/fabrika-old";
import { blindDraw, sealAsk } from "@kampus/pipeline/tickets/ask";
import { Entry } from "@kampus/pipeline/tickets/ticket";
import { Effect, Schema } from "effect";
import { describe, expect } from "vitest";
import { DRAFT, FILED, NOW, OWNER, policyFor, type Sealed } from "../../../fixtures/ask-desk/cases.ts";
import { property } from "../../../fixtures/ask-desk/property.ts";
import { type Asks, AsksNow, asksMachine, asksNow, load, NO_MARKS } from "./asks.ts";

// Today's version. Review 7 of the ask desk's fix list (askdesk-review.md): what the host sends
// every page holds each ask's display data and hash, never the sealed rec or the blind draw. A
// blind ask's rec would otherwise reach the page and its asks menu even when it is hidden.

const seal: (draft: unknown, policy?: { seed: number }) => Effect.Effect<Sealed, unknown> = sealAsk;
type Msg = MsgOf<typeof asksMachine>;
const step = (model: Asks, msg: Msg) => applyCell<Asks, Msg, ReturnType<typeof load>>(asksMachine, model, msg)[0];

const entry = (pos: number, fact: unknown) =>
  Schema.decodeUnknownSync(Entry)({ pos, ticket: 117, by: OWNER, at: NOW, fact });

const initial = (entries: readonly Entry[]) =>
  step(asksMachine.init(null, NO_MARKS)[0], load.ok(load({ after: 0 }), { entries, last: entries.length }, 0));

/** Every key path in a value, as `a.b.c`. */
const pathsIn = (value: unknown, at = ""): readonly string[] =>
  typeof value !== "object" || value === null
    ? []
    : Object.entries(value).flatMap(([key, v]) => {
        const here = Array.isArray(value) ? at : at === "" ? key : `${at}.${key}`;
        return [...(Array.isArray(value) ? [] : [here]), ...pathsIn(v, here)];
      });

describe("ask desk review 7: the page never receives the sealed rec", () => {
  property("the asks sent to every page hold shows and saw only", { hidden: Schema.Boolean }, async ({ hidden }) => {
    // A blind ask is a step's: an approve ask is never drawn blind (review 2, medium 2).
    const draft = hidden ? { ...DRAFT, for: "step" } : DRAFT;
    const ask = await Effect.runPromise(seal(draft, policyFor(DRAFT.ask, hidden, blindDraw)));
    const sent = Schema.encodeSync(AsksNow)(asksNow(initial([entry(1, FILED), entry(2, ask)])));
    expect(sent.asks).toHaveLength(1);
    const keys = pathsIn(sent);
    expect(keys.filter((k) => /(^|\.)rec$/.test(k) && !/(^|\.)shows\.rec$/.test(k))).toEqual([]);
    expect(keys.filter((k) => /(^|\.)blind$/.test(k))).toEqual([]);
    const text = JSON.stringify(sent);
    expect(text).toContain(ask.saw);
    expect(text).toContain(DRAFT.what);

    if (hidden) {
      expect(text).not.toContain(DRAFT.rec.why);
      expect(text).not.toContain(DRAFT.rec.cost);
    }
  });
});
