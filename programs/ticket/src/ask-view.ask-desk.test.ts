import { Asked, blindDraw, sealAsk } from "@kampus/pipeline/tickets/ask";
import { Entry, fold, type Ticket } from "@kampus/pipeline/tickets/ticket";
import { AskActions, AskView } from "@tea-fabrika/tracker/ask-window";
import * as AskWindow from "@tea-fabrika/tracker/ask-window";
import { Effect, Schema } from "effect";
import fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AGENT, DRAFT, FILED, HEAD, NOW, OWNER, policyFor, TOOK } from "../../../fixtures/ask-desk/cases.ts";
import { property } from "../../../fixtures/ask-desk/property.ts";
import { pageOf, type Shown } from "./view.ts";
import { TicketWindow } from "./window.tsx";

// Today's version. Round 4 of the ask desk's tests, from the review's and the shots' fix lists
// (askdesk-review.md): what the markup of the shared ask view and the ticket's turn card must hold.
// Drawn on Node with no browser, as window.from.test.ts draws the window. How each thing looks
// is the shots' job; these read the markup only.

const sealed = (draft: unknown = DRAFT) => Effect.runPromise(sealAsk(draft, policyFor(DRAFT.ask, false, blindDraw)));

/** The actions a window gives the ask view: keys as the default table has them, nothing sent. */
const ACTIONS: AskActions = {
  openLane: () => {},
  command: () => undefined,
  answer: () => Effect.succeed(null),
  later: () => {},
  keys: { rec: ["y"], not: ["n"], picks: ["o"], later: ["h"] },
  blocked: () => false,
};

const view = (ask: Asked) =>
  renderToStaticMarkup(
    createElement(AskActions.Provider, { value: ACTIONS }, createElement(AskView, { ticket: 117, ask })),
  );

/** Markup with its tags taken out and its spaces made one. */
const textOf = (markup: string): string =>
  markup
    .replaceAll("<!-- -->", "")
    .replaceAll(/<[^>]*>/g, " ")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll(/\s+/g, " ")
    .trim();

/** The element that opens at `start` in `markup`, to its own closing tag. */
const elementAt = (markup: string, start: number): string => {
  const tag = /^<([a-z0-9]+)/.exec(markup.slice(start))?.[1];

  if (tag === undefined) {
    throw new Error("no element there");
  }

  let depth = 0;
  const re = new RegExp(`<(/?)${tag}\\b[^>]*?(/?)>`, "g");
  re.lastIndex = start;

  for (let m = re.exec(markup); m !== null; m = re.exec(markup)) {
    if (m[2] === "/") {
      continue;
    }

    depth += m[1] === "/" ? -1 : 1;

    if (depth === 0) {
      return markup.slice(start, re.lastIndex);
    }
  }

  throw new Error(`no end for <${tag}>`);
};

const firstOf = (markup: string, open: RegExp): string => {
  const at = markup.search(open);

  if (at < 0) {
    throw new Error(`no ${open} in the markup`);
  }

  return elementAt(markup, at);
};

describe("ask desk review 10: the toolbar is one tab stop", () => {
  it("one control in the toolbar takes Tab, the rest roam by arrow keys", async () => {
    await onAnyAsk((ask) => {
      const toolbar = firstOf(view(ask), /<div[^>]*role="toolbar"/);
      const container = /^<div[^>]*>/.exec(toolbar)?.[0] ?? "";
      const inner = toolbar.slice(container.length);
      const tabbable = [...inner.matchAll(/<(button|a|input|textarea|select)\b[^>]*>/g)].filter(
        ([tag]) => !/tabindex="-1"/.test(tag) && !/\bdisabled=""/.test(tag),
      );
      const stops = tabbable.length + (/tabindex="0"/.test(container) ? 1 : 0);
      expect(stops).toBe(1);
    });
  });
});

describe("ask desk review 11: Later is a button in the ask view", () => {
  it("the shared ask view has a Later button, in the ticket and the tracker alike", async () => {
    await onAnyAsk((ask) => {
      const markup = view(ask);
      const buttons = [...markup.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(([b]) => textOf(b));
      expect(buttons.some((b) => /^Later\b/.test(b))).toBe(true);
    });
  });
});

const CHANGE = {
  _tag: "change",
  head: HEAD,
  diff: "--- a/src/slug.ts\n+++ b/src/slug.ts\n-export const slug = (t: string) => t\n+export const slug = (t: string) => t.trim().toLowerCase()",
  checks: [{ name: "ci", state: "passed" }],
  review: { met: 4, of: 4, title: "Read names in one form" },
  rules: [{ path: "rules/slug.md", text: "A slug is lower case." }],
  text: "One finding was let through.",
};

describe("ask desk review 9 and shot S5: evidence is drawn as text", () => {
  describe.each([
    ["plan", DRAFT.evidence],
    ["change", CHANGE],
    ["other", { _tag: "other", text: "The build stopped and needs your call." }],
  ])("%s evidence", (_, evidence) => {
    property("reads as words, with no JSON and no tag", { id: Asked.fields.ask }, async ({ id }) => {
      const markup = view(await sealed({ ...DRAFT, ask: id, evidence }));
      const drawn = textOf(firstOf(markup, /<div class="ask-evidence"/));
      expect(drawn).not.toMatch(/_tag/);
      expect(drawn).not.toMatch(/[{}]|"\w+":/);
      expect(markup).not.toMatch(/<pre\b[^>]*>\s*\{/);
    });
  });
  property("plan evidence names the summary, each question and its lean", { id: Asked.fields.ask }, async ({ id }) => {
    const drawn = textOf(firstOf(view(await sealed({ ...DRAFT, ask: id })), /<div class="ask-evidence"/));
    const { plan } = DRAFT.evidence;
    expect(drawn).toContain(plan.summary);

    for (const q of plan.questions as readonly { ask: string; lean: string }[]) {
      expect(drawn).toContain(q.ask);
      expect(drawn).toContain(q.lean);
    }
  });
  property(
    "change evidence names the checks, the rule files and the words beside the change",
    { id: Asked.fields.ask },
    async ({ id }) => {
      const drawn = textOf(
        firstOf(view(await sealed({ ...DRAFT, ask: id, evidence: CHANGE })), /<div class="ask-evidence"/),
      );
      expect(drawn).toContain("ci");
      expect(drawn).toContain("rules/slug.md");
      expect(drawn).toContain("A slug is lower case.");
      expect(drawn).toContain(CHANGE.text);
      expect(drawn).toContain("t.trim().toLowerCase()");
    },
  );
});

describe("shot S8: no machine ids in what the person reads", () => {
  it("the ask view never shows the ask's id", async () => {
    await onAnyAsk((ask) => {
      expect(textOf(view(ask))).not.toContain(ask.ask);
    });
  });
});

// ---- design E (owner, 2026-11-08): what the bar draws before anything is pressed

const POOL = [
  { pick: "approve", does: "Take the lean on each open question and write the tests" },
  { pick: "no", does: "Keep the lane parked for a new plan" },
  { pick: "split", does: "Split the plan into two tickets and ask again" },
  { pick: "stop", does: "Stop the lane here" },
];

/** Any sealed ask: two to four picks, a rec shown on one of them, drawn blind, or none. */
const anyAsk = fc
  .record({
    picks: fc.subarray(POOL, { minLength: 2 }),
    at: fc.nat(),
    rec: fc.constantFrom("shown", "blind", "none"),
    sure: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    n: fc.nat({ max: 1_000_000 }),
  })
  .map(({ picks, at, rec, sure, n }) => {
    const chosen = picks[at % picks.length]?.pick ?? "approve";
    const ask = `a-e-${n}`;
    const draft = {
      ...DRAFT,
      ask,
      picks,
      rec:
        rec === "none" ? { _tag: "none", why: "No recommendation was recorded" } : { ...DRAFT.rec, pick: chosen, sure },
      // A blind ask is a step's: an approve ask is never drawn blind (review 2, medium 2).
      ...(rec === "blind" ? { for: "step" } : {}),
    };
    return { rec, draft, policy: policyFor(ask, rec === "blind", blindDraw) };
  });

const sealedAny = (a: { draft: unknown; policy: { seed: number } }) => Effect.runPromise(sealAsk(a.draft, a.policy));

async function onAnyAsk(check: (ask: Asked) => void) {
  await fc.assert(
    fc.asyncProperty(anyAsk, async (a) => check(await sealedAny(a))),
    { seed: 119120 },
  );
}

/** How many times the words say Recommended. */
const recommendedIn = (text: string) => text.match(/\brecommended\b/gi)?.length ?? 0;
/** Design E's fix 3 on the drawn words: once for a shown rec, never for a blind or no-rec ask. */
const recommendedOnce = (rec: string, text: string) => recommendedIn(text) === (rec === "shown" ? 1 : 0);
const MARKS_GROUP = /<div[^>]*role="group"[^>]*aria-label="Did this need you\?"/g;
const REC_LINE = /<[a-z0-9]+\b[^>]*class="(?:[^"]* )?ask-rec(?: [^"]*)?"/;

/**
 * Option d (owner, 2026-11-08) on the drawn markup: before anything is pressed, one "Did this need
 * you?" group with both marks sits at the end of the rec line (the element with class `ask-rec`),
 * never on a row of its own. A blind or no-rec ask's line is the same element.
 */
const marksOnTheLine = (markup: string) => {
  if ([...markup.matchAll(MARKS_GROUP)].length !== 1) {
    return false;
  }

  const line = firstOf(markup, REC_LINE);
  const at = line.search(MARKS_GROUP);

  if (at < 0) {
    return false;
  }

  const group = elementAt(line, at);
  const after = line.slice(at + group.length);
  return /needed me/i.test(textOf(group)) && /agent could work it out/i.test(textOf(group)) && textOf(after) === "";
};

describe("ask desk design E: the bar before anything is pressed", () => {
  it("says Recommended once for a shown rec and never for a blind or no-rec ask", async () => {
    await fc.assert(
      fc.asyncProperty(anyAsk, async (a) => {
        expect(recommendedOnce(a.rec, textOf(view(await sealedAny(a))))).toBe(true);
      }),
      { seed: 119120, numRuns: 60 },
    );
  });
  it("offers both marks before a pick, at the end of the rec line", async () => {
    await fc.assert(
      fc.asyncProperty(anyAsk, async (a) => {
        expect(marksOnTheLine(view(await sealedAny(a)))).toBe(true);
      }),
      { seed: 119120, numRuns: 60 },
    );
  });
  // The plants: the look branch's design E drew both of these.
  // format: exact invalid display text used to test the recommendation-word checker itself.
  it("format: the planted blind line Recommended · Hidden until you pick is caught", () => {
    expect(recommendedOnce("blind", "Your turn Recommended Hidden until you pick")).toBe(false);
  });
  // format: this literal invalid HTML template tests the markup checker, not a generated ask.
  it("format: the planted marks on a row of their own, after the rec line, are caught", () => {
    expect(
      marksOnTheLine(
        '<p class="ask-rec">Recommended approve · 95% sure</p><div role="group" aria-label="Did this need you?"><button type="button">Needed me</button><button type="button">Agent could work it out</button></div>',
      ),
    ).toBe(false);
  });
  // format: the literal missing-marks template must be rejected by the markup checker.
  it("format: the planted marks drawn only after a pick are caught", () => {
    expect(marksOnTheLine('<p class="ask-rec">Recommended approve · 95% sure</p>')).toBe(false);
  });
  // format: the exact valid HTML template is a positive control for that same checker.
  it("format: marks at the end of the rec line pass", () => {
    expect(
      marksOnTheLine(
        '<div class="ask-rec"><span>Recommended approve · 95% sure</span><div role="group" aria-label="Did this need you?"><button type="button">Needed me</button><button type="button">Agent could work it out</button></div></div>',
      ),
    ).toBe(true);
  });
});

// ---- the ticket's own window

const ticketOf = (facts: readonly unknown[]): Ticket => {
  const entries = facts.map((fact, i) =>
    Schema.decodeUnknownSync(Entry)({
      pos: i + 1,
      ticket: 117,
      by: i === 0 ? OWNER : AGENT,
      at: NOW - 60_000 + i,
      fact,
    }),
  );
  const [ticket] = fold([], entries).tickets;

  if (ticket === undefined) {
    throw new Error("the fold made no ticket");
  }

  return ticket;
};

const drawn = (ticket: Ticket): string => {
  const shown: Shown = {
    ready: true,
    number: ticket.number,
    page: pageOf(ticket, NOW, [ticket]),
    saving: [],
    failed: null,
    unreachable: null,
    now: NOW,
  };
  return renderToStaticMarkup(
    createElement(
      AskActions.Provider,
      { value: ACTIONS },
      createElement(TicketWindow, { view: shown, send: () => {} }),
    ),
  );
};

const RUNNING = { type: "started", run: "r-build-121", stage: "build", task: null, log: null };

const MERGED = {
  type: "pr",
  url: "https://github.com/fixture/project/pull/1",
  state: "merged",
  head: HEAD,
  checks: [],
};

const turnOf = (markup: string) => firstOf(markup, /<section[^>]*aria-label="Whose turn"/);

describe("ask desk P12: the ticket's status counts its waiting asks", () => {
  // Today's version. Mutation found that a window could always pass zero to AskStatus.
  // Its own DOM laws cover the announcement; this checks the count the ticket gives it.
  property(
    "gives the live region every waiting ask, and zero when none wait",
    { count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(8)) },
    async ({ count }) => {
      const status = vi.spyOn(AskWindow, "AskStatus");

      try {
        for (const total of new Set([0, 1, count])) {
          const asks = await Promise.all(
            Array.from({ length: total }, (_, i) => sealed({ ...DRAFT, ask: `a-status-${i}` })),
          );
          drawn(ticketOf([FILED, ...asks]));
          expect(status.mock.calls.at(-1)?.[0].left).toBe(total);
        }
      } finally {
        status.mockRestore();
      }
    },
  );
});

describe("ask desk review 6: one status region, always there, outside the ask view", () => {
  describe.each([
    ["waits on an ask", async () => [FILED, await sealed()]],
    ["runs", async () => [FILED, RUNNING]],
    ["is done", async () => [FILED, MERGED]],
  ])("when the ticket %s", (_, facts) => {
    property("its window holds a polite status region", { id: Schema.Int }, async ({ id }) => {
      const all = await facts();
      const markup = drawn(ticketOf([{ ...FILED, title: `Ticket ${id}` }, ...all.slice(1)]));
      const ask = markup.search(/<section class="ask-view"/);
      const outside = ask < 0 ? markup : markup.replace(elementAt(markup, ask), "");
      expect(outside).toMatch(/<[a-z]+\b[^>]*role="status"/);
      const status = firstOf(outside, /<[a-z]+\b[^>]*role="status"/);
      expect(status).not.toMatch(/aria-live="(off|assertive)"/);
    });
  });
});

describe("shot S8: the running card names no run id", () => {
  // pinned: round 4 shot S8 exposed r-build-121 as the running card's label.
  it("pinned: says the step that runs and since when, never r-build-121", () => {
    const turn = textOf(turnOf(drawn(ticketOf([FILED, RUNNING]))));
    expect(turn).not.toContain("r-build-121");
    expect(turn).not.toMatch(/\br-[a-z_]+-\d+\b/);
  });
});

describe("shot S9: the done card draws its check once", () => {
  // pinned: round 4 shot S9's double-check-mark bug on the completed ticket card.
  it("pinned: one check mark, beside the word Done", () => {
    const turn = turnOf(drawn(ticketOf([FILED, MERGED])));
    const marks = (textOf(turn).match(/✓/g) ?? []).length + (turn.match(/<svg\b/g) ?? []).length;
    expect(marks).toBe(1);
    expect(textOf(turn)).toContain("Done");
  });
});

// ---- design E (owner, 2026-11-08): the bar is the ask

const QUESTIONS = [
  DRAFT.what,
  "Approve plan v2 for the slug fix?",
  "Merge the change that trims slugs?",
  "Split the ticket into two?",
];

/** Any sealed ask with any of the questions, and what ends it: an answer or a withdrawal. */
const anyOpenAsk = fc
  .record({
    a: anyAsk,
    what: fc.constantFrom(...QUESTIONS),
    end: fc.constantFrom("answered", "withdrawn"),
  })
  .map(({ a, what, end }) => ({ ...a, draft: { ...(a.draft as object), what }, what, end }));

const entriesOf = (facts: readonly { readonly type: string }[]): Ticket => {
  const entries = facts.map((fact, i) =>
    Schema.decodeUnknownSync(Entry)({
      pos: i + 1,
      ticket: 117,
      by: i === 0 || fact.type === "answered" ? OWNER : AGENT,
      at: NOW - 60_000 + i,
      fact,
    }),
  );
  const [ticket] = fold([], entries).tickets;

  if (ticket === undefined) {
    throw new Error("the fold made no ticket");
  }

  return ticket;
};

/** The words of the window's Activity section. */
const activityOf = (markup: string) => textOf(firstOf(markup, /<section aria-label="Activity"/));

/**
 * The fact that ends `ask`: an expired withdrawal (a "changed" one stays open until its replacement
 * stands, as closedAsks reads it), or the rec taken where one is drawn, else the first pick chosen. */
const endOf = (ask: Asked, end: string) =>
  end === "withdrawn"
    ? { type: "withdrawn", ask: ask.ask, why: "expired" }
    : {
        type: "answered",
        format: 1,
        ask: ask.ask,
        answer:
          ask.shows.rec._tag === "pick"
            ? { _tag: "rec" }
            : { _tag: "chose", pick: ask.shows.picks[0]?.pick ?? "approve" },
        saw: ask.saw,
        via: { _tag: "window", took: TOOK },
      };

describe("ask desk design E: the bar is the ask, so the activity does not say it again", () => {
  it("while an ask is open, the activity has no 'asks you' row for it; once it ends, the row is back", async () => {
    await fc.assert(
      fc.asyncProperty(anyOpenAsk, async (a) => {
        const ask = await sealedAny(a);
        const row = `asks you: ${a.what}`;
        const comment = { type: "commented", body: "Keep this activity note." };
        const open = drawn(entriesOf([FILED, comment, ask]));
        expect(textOf(open)).toContain(a.what);
        expect(activityOf(open)).not.toContain(row);
        expect(activityOf(open)).toContain(comment.body);
        expect(activityOf(drawn(entriesOf([FILED, ask, endOf(ask, a.end)])))).toContain(row);
        // A "changed" withdrawal with no replacement yet leaves the ask open, so still no row.
        const changed = { type: "withdrawn", ask: ask.ask, why: "changed" };
        expect(activityOf(drawn(entriesOf([FILED, ask, changed])))).not.toContain(row);
      }),
      { seed: 119120, numRuns: 40 },
    );
  });
});
