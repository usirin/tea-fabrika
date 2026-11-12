// P14 slice 2, next/ (ticket 828): the checklist window's markup, law L24 of the approved plan (W1,
// W3). Written before `window.tsx`. It renders through `createElement` and `react-dom/server`, so no
// test file holds JSX, and reads the static markup: no DOM.
//
// The shape this law holds `window.tsx` to, from the plan (the build may add more):
// - `checklistWindow.View(props)` takes `WindowProps` (`data`, `press`, `hint?`, `refusal`) and the
//   tile props (`tile`, the tile machine's Model `{draft}`, and `send`). Render is pure: it calls
//   neither `press` nor `send`.
// - One Manti `Checkbox` per item, named by the item and checked when the item is, its state also as
//   a word beside it (`Open` for new and open, `Late`, `Done`), never color alone (WCAG 1.4.1); a
//   `Remove <name>` button per item; `<n> left` from `view.left`; `Nothing on the list yet.` for none;
//   a text field labeled by the add input's description, `maxLength` 80, showing the draft, with the
//   refusal words tied to it by `aria-describedby`.
// - `checklistWindow.refused(m, reason)`: `taken` and `missing` name the item; any other reason gets
//   Tuval's default, which names a word reason and never echoes free text.
//
// The views come from the real program: each run folds the real machine with Msgs legal in its model
// (adds, checks, removes and timers), then renders its view with a refusal drawn from the program's
// reasons, other words, free text or none.
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import * as fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { checklist, checklistMachine } from "./program.ts";
import { checklistWindow } from "./window.tsx";

const SEED = 119120;
const DAY = 86_400_000;

type Model = typeof checklistMachine.model.Type;
type Msg = typeof checklistMachine.msg.Type;
type View = ReturnType<typeof checklist.view.select>;

/** The state words the plan gives each item state (W1): a word beside the mark, never color alone. */
const WORDS = { new: "Open", open: "Open", late: "Late", checked: "Done" } as const;

const unescape = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** The text a person reads: the markup without its tags. */
const text = (html: string) => unescape(html.replace(/<[^>]*>/g, " "));

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m === null ? null : unescape(m[1]!);
};

/** The text of the element whose id is `id`, up to its own closing tag. */
const byId = (html: string, id: string): string | null => {
  const open = new RegExp(`<([a-z]+)[^>]*\\sid="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`).exec(html);

  if (open === null) {
    return null;
  }

  const end = html.indexOf(`</${open[1]}>`, open.index + open[0].length);
  return text(html.slice(open.index + open[0].length, end < 0 ? undefined : end)).trim();
};

/** A control's accessible name in this markup: its aria-label, its labelledby text or its `for` label. */
const named = (html: string, tag: string): string | null => {
  const label = attr(tag, "aria-label");

  if (label !== null) {
    return label;
  }

  const by = attr(tag, "aria-labelledby");

  if (by !== null) {
    return by
      .split(/\s+/)
      .map((id) => byId(html, id) ?? "")
      .join(" ")
      .trim();
  }

  const id = attr(tag, "id");
  const forLabel = id === null ? null : new RegExp(`<label[^>]*\\sfor="${id}"[^>]*>([\\s\\S]*?)</label>`).exec(html);
  return forLabel === null ? null : text(forLabel[1]!).trim();
};

const tags = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].map((m) => m[0]);

const name = fc.oneof(
  fc.stringMatching(/^[a-z][a-z &<>"']{0,20}$/).map((s) => s.trimEnd()),
  fc.constant("a".repeat(80)),
);

const choice = fc.record({ move: fc.nat(), pick: fc.nat(), name, later: fc.integer({ min: 0, max: 2 * DAY }) });
type Choice = typeof choice extends fc.Arbitrary<infer C> ? C : never;

/** Folds the real machine through Msgs legal in its model, as the brain would accept them. */
const fold = (list: ReadonlyArray<Choice>): ReadonlyArray<View> => {
  let model: Model = checklistMachine.init(null, {})[0];
  let now = 1_000_000;
  const views = [checklist.view.select(model)];

  for (const c of list) {
    const held = model.items.length === 0 ? null : model.items[c.pick % model.items.length]!.name;
    const options: Array<Msg> = [
      { type: "add", name: c.name },
      // Once an item is stamped, its real wake time makes the late state reachable.
      { type: "timer", at: Math.max(now, checklist.wake(model) ?? now) + c.later },
      ...(held === null
        ? []
        : ([
            { type: "check", name: held },
            { type: "uncheck", name: held },
            { type: "remove", name: held },
          ] as const)),
    ];
    const msg = options[c.move % options.length]!;

    if (checklist.refuse(model, msg) === null) {
      model = applyCell(checklistMachine, model, msg)[0];
      now = msg.type === "timer" ? msg.at : now;
      views.push(checklist.view.select(model));
    }
  }

  return views;
};

const refused = checklistWindow.refused!;

const REASONS = fc.oneof(
  fc.constantFrom("taken", "missing", "bad_msg", "too_many"),
  fc.stringMatching(/^[A-Z][a-z]{2,8} [a-z ]{2,12}!$/),
);

const render = (view: View, refusal: string | null, draft: string) =>
  renderToStaticMarkup(
    createElement(checklistWindow.View, {
      data: view,
      refusal,
      press: () => {
        throw new Error("render pressed");
      },
      tile: { draft },
      send: () => {
        throw new Error("render sent");
      },
    }),
  );

const walks = fc.array(choice, { minLength: 20, maxLength: 60 }).map(fold);
const views = walks.chain((walk) => fc.constantFrom(...walk));

describe("L24: the checklist window's markup", () => {
  it("one named box per item, checked as the view says, its state as a word, a remove per item and the count left", () => {
    const seen = { empty: 0, checked: 0, late: 0 };
    fc.assert(
      fc.property(walks, fc.string({ maxLength: 80 }), (walk, draft) => {
        for (const view of walk) {
          const html = render(view, null, draft);
          const boxes = tags(html, /<input[^>]*type="checkbox"[^>]*>/g);
          expect(boxes, "one box per item").toHaveLength(view.items.length);
          expect(boxes.map((b) => named(html, b)).sort()).toEqual(view.items.map((i) => i.name).sort());
          expect(
            boxes.filter((b) => /\schecked=""/.test(b)).map((b) => named(html, b)),
            "a box is checked exactly when its item is",
          ).toEqual(view.items.filter((i) => i.state === "checked").map((i) => i.name));

          const read = text(html);

          for (const word of new Set(Object.values(WORDS))) {
            const count = view.items.filter((i) => WORDS[i.state] === word).length;
            expect(read.match(new RegExp(`\\b${word}\\b`, "g"))?.length ?? 0, `${word} words`).toBe(count);
          }

          const buttons = tags(html, /<button[^>]*>[\s\S]*?<\/button>/g).map(
            (b) => attr(b, "aria-label") ?? text(b).trim(),
          );

          for (const item of view.items) {
            expect(buttons, `a remove for ${item.name}`).toContain(`Remove ${item.name}`);
          }

          expect(read).toContain(`${view.left} left`);
          expect(read.includes("Nothing on the list yet."), "the empty line shows exactly when there is none").toBe(
            view.items.length === 0,
          );
          seen.empty += view.items.length === 0 ? 1 : 0;
          seen.checked += view.items.some((i) => i.state === "checked") ? 1 : 0;
          seen.late += view.items.some((i) => i.state === "late") ? 1 : 0;
        }
      }),
      { seed: SEED, numRuns: 50 },
    );
    expect(seen.empty).toBeGreaterThan(0);
    expect(seen.checked).toBeGreaterThan(0);
    expect(seen.late).toBeGreaterThan(0);
  });

  it("the add field is labeled by the add input's description, capped at 80, shows the draft and carries the refusal words", () => {
    let shown = 0;
    fc.assert(
      fc.property(views, fc.string({ maxLength: 80 }), fc.option(REASONS), name, (view, draft, reason, item) => {
        const words = reason === null ? null : refused({ type: "add", name: item }, reason);
        const html = render(view, words, draft);
        const fields = tags(html, /<input[^>]*type="text"[^>]*>/g);
        expect(fields).toHaveLength(1);
        const field = fields[0]!;
        expect(named(html, field)).toBe(checklist.inputs.add.description);
        expect(attr(field, "maxLength") ?? attr(field, "maxlength")).toBe("80");
        expect(attr(field, "value") ?? "").toBe(draft);
        const described = (attr(field, "aria-describedby") ?? "")
          .split(/\s+/)
          .filter((id) => id !== "")
          .map((id) => byId(html, id) ?? "")
          .join(" ")
          .trim();

        if (words === null) {
          expect(described, "no refusal, no description words").toBe("");
          return;
        }

        shown++;
        expect(described, "the refusal is tied to the field").toContain(words);
      }),
      { seed: SEED, numRuns: 50 },
    );
    expect(shown).toBeGreaterThan(0);
  });

  it("refused words name the item for taken and missing; other reasons get the default, which never echoes free text", () => {
    fc.assert(
      fc.property(name, REASONS, REASONS, (item, a, b) => {
        const taken = refused({ type: "add", name: item }, "taken");
        const missing = refused({ type: "check", name: item }, "missing");
        expect(taken).toContain(`"${item}"`);
        expect(missing).toContain(`"${item}"`);
        expect(taken).not.toBe(missing);
        const word = (r: string) => /^[a-z_]{1,40}$/.test(r);

        for (const r of [a, b].filter((r) => r !== "taken" && r !== "missing")) {
          const said = refused({ type: "remove", name: item }, r);
          expect(said.includes(`"${item}"`), `${r} named the item`).toBe(false);
          expect(said.includes(r), `${r}'s words`).toBe(word(r));
        }

        const free = [a, b].filter((r) => !word(r));

        if (free.length === 2) {
          expect(refused({ type: "add", name: item }, free[0]!)).toBe(refused({ type: "add", name: item }, free[1]!));
        }
      }),
      { seed: SEED, numRuns: 50 },
    );
  });
});
