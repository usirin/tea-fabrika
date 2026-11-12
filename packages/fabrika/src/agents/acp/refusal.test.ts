import type * as acp from "@agentclientprotocol/sdk/unstable";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { refusal } from "./refusal.ts";

// Ticket 837: how a contained run says no to one permission request. ACP's kind cannot tell a no
// that keeps the turn from one that ends it (Codex labels both `decline` and `cancel`
// `reject_once`), so the harness row names the ids that end its maker's turn (`cancels`), and
// `refusal` picks a no outside them: `reject_once` first, then `reject_always`, never an allow.
//
//   refusal([allow_once, allow_for_session, cancel, decline], ["cancel"])
//   // { _tag: "refuse", optionId: "decline" }
//   refusal([allow_once, allow_for_session, cancel], ["cancel"])
//   // { _tag: "cannot" }

/** Seed 119120: the shared one (AGENTS.md). Default runs. */
const OPTS = { seed: 119120 };

const ALLOWS = ["allow_once", "allow_always"] as const;
const REJECTS = ["reject_once", "reject_always"] as const;
const isReject = (kind: string) => (REJECTS as readonly string[]).includes(kind);
const isAllow = (kind: string) => (ALLOWS as readonly string[]).includes(kind);

/** The four ACP kinds, or an unknown one: ACP's kind is `string` past the four. */
const kind = fc.oneof(
  { arbitrary: fc.constantFrom(...ALLOWS, ...REJECTS), weight: 4 },
  { arbitrary: fc.string(), weight: 1 },
);

/** Codex's own ids come up often, so a drawn list holds `cancel` and `decline` side by side. */
const optionId = fc.oneof(fc.constantFrom("cancel", "decline", "yes", "no", "reject_permissions"), fc.string());

const option = (kinds: fc.Arbitrary<string> = kind): fc.Arbitrary<acp.PermissionOption> =>
  fc.record({ optionId, name: fc.string(), kind: kinds });

interface Drawn {
  readonly options: readonly acp.PermissionOption[];
  readonly cancels: readonly string[];
}

/** Options with unique ids (ACP's MUST), and `cancels` from some of those ids plus made-up ones. */
const drawn: fc.Arbitrary<Drawn> = fc
  .uniqueArray(option(), { selector: (o) => o.optionId, maxLength: 8 })
  .chain((options) =>
    fc
      .tuple(fc.subarray(options.map((o) => o.optionId)), fc.array(fc.string(), { maxLength: 2 }))
      .map(([some, made]) => ({ options, cancels: [...some, ...made] })),
  );

/** The option `refusal` picked, or `null` for `cannot`. */
const picked = ({ options, cancels }: Drawn) => {
  const r = refusal(options, cancels);

  if (r._tag === "cannot") {
    return null;
  }

  const o = options.find((x) => x.optionId === r.optionId);
  expect(o, `${r.optionId} is not an offered option`).toBeDefined();
  return o ?? null;
};

/** The offered nos that keep the turn: a reject kind, outside `cancels`. */
const keeping = ({ options, cancels }: Drawn) =>
  options.filter((o) => isReject(o.kind) && !cancels.includes(o.optionId));

const opt = (optionId: string, kind: string): acp.PermissionOption => ({ optionId, name: optionId, kind });

/** codex-acp 2.5.0 `fileChangeDecisionOptions` (dist/index.js:38352-38367): `cancel` its only no. */
const CODEX_FILE_CHANGE: Drawn = {
  options: [opt("allow_once", "allow_once"), opt("allow_for_session", "allow_always"), opt("cancel", "reject_once")],
  cancels: ["cancel"],
};

/** A codex-acp 2.5.0 command whose decisions put `cancel` before `decline`, both `reject_once`. */
const CODEX_CANCEL_FIRST: Drawn = {
  options: [
    opt("allow_once", "allow_once"),
    opt("allow_for_session", "allow_always"),
    opt("cancel", "reject_once"),
    opt("decline", "reject_once"),
  ],
  cancels: ["cancel"],
};

describe("refusal (ticket 837)", () => {
  it("L1: a refuse names an offered reject option whose id is not in cancels", () => {
    fc.assert(
      fc.property(drawn, (d) => {
        const o = picked(d);
        expect(o === null || (isReject(o.kind) && !d.cancels.includes(o.optionId))).toBe(true);
      }),
      {
        ...OPTS,
        // pinned: the ticket's bug. The adapter took the first `reject_once`, so a Codex command
        // offering `cancel` before `decline` got `cancel`, and the turn ended.
        examples: [[CODEX_CANCEL_FIRST]],
      },
    );
  });

  it("L2: cannot exactly when no reject option outside cancels is offered", () => {
    fc.assert(
      fc.property(drawn, (d) => {
        expect(refusal(d.options, d.cancels)._tag === "cannot").toBe(keeping(d).length === 0);
      }),
      {
        ...OPTS,
        // pinned: the ticket's bug. A Codex file change offers only `cancel` as its no; it was
        // picked, and the turn ended `cancelled` instead of failing `cannot_refuse`.
        examples: [[CODEX_FILE_CHANGE], [{ options: [], cancels: [] }]],
      },
    );
  });

  it("L3: a reject_once outside cancels is picked whenever one is offered", () => {
    /** The drawn list with a `reject_always` outside `cancels` put somewhere in it. */
    const withAlways = drawn.chain((d) =>
      fc
        .tuple(fc.string(), fc.nat({ max: d.options.length }))
        .filter(([id]) => !d.options.some((o) => o.optionId === id) && !d.cancels.includes(id))
        .map(([id, at]) => ({
          ...d,
          options: [...d.options.slice(0, at), opt(id, "reject_always"), ...d.options.slice(at)],
        })),
    );
    fc.assert(
      fc.property(withAlways, (d) => {
        const once = keeping(d).some((o) => o.kind === "reject_once");
        expect(!once || picked(d)?.kind === "reject_once").toBe(true);
      }),
      OPTS,
    );
  });

  it("L4: the order of the list never changes the tag or the kind picked", () => {
    const shuffled = drawn.chain((d) =>
      fc
        .shuffledSubarray([...d.options], { minLength: d.options.length, maxLength: d.options.length })
        .map((options) => ({ d, again: { ...d, options } })),
    );
    fc.assert(
      fc.property(shuffled, ({ d, again }) => {
        expect(picked(again)?.kind ?? null).toBe(picked(d)?.kind ?? null);
        expect(refusal(again.options, again.cancels)._tag).toBe(refusal(d.options, d.cancels)._tag);
      }),
      OPTS,
    );
  });

  it("L5: never an allow, even when allows come first", () => {
    const allowsFirst = fc
      .tuple(
        fc.uniqueArray(option(fc.constantFrom(...ALLOWS)), { selector: (o) => o.optionId, minLength: 1, maxLength: 3 }),
        drawn,
      )
      .map(([allows, d]) => ({
        ...d,
        options: [...allows.filter((a) => !d.options.some((o) => o.optionId === a.optionId)), ...d.options],
      }));
    fc.assert(
      fc.property(allowsFirst, (d) => {
        const o = picked(d);
        expect(o === null || !isAllow(o.kind)).toBe(true);
      }),
      {
        ...OPTS,
        // pinned: experiments 76 and 156, a contained run never allows; a request with no
        // keeping no is `cannot`, never its first option.
        examples: [[CODEX_FILE_CHANGE]],
      },
    );
  });
});
