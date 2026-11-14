// fabsh in a tile, slice 1, next/: the window's laws L3 and L16 of the approved plan
// (docs/plan/lanes/fabsh-PLAN.md, "Laws"). Written before `window.tsx`, `tile.ts`, `read.ts` and
// `program.ts`, which the build creates; until it does, this file fails on its missing imports. It
// renders through `createElement` and `react-dom/server`, so no test file holds JSX, and reads the
// static markup: no DOM.
//
// The shape these laws hold `window.tsx` to, from the plan's "The tile and its view" (the build may
// add more):
// - `fabshWindow`: `defineWindow(fabsh, {data, View, keys, tile, refused})`. `View(props)` takes the
//   window props (`data` the view `{history, scroll, programs}`, `press`, `refusal`) and the tile
//   props (`tile`, the tile machine's Model, and `send`). Render is pure: it calls neither.
// - The drawn line (`drawn(tile)`) is one labeled text input. Behind it, an `aria-hidden` layer holds
//   one element per span of `read(line, known)`, in order, each with `data-role` set to the span's
//   role and the span's characters as its text. This markup convention is what these laws add to the
//   plan's sketch, and the report names it.
// - The status: the element(s) the input's `aria-describedby` names, `aria-live="polite"`, holding
//   `said(span, line)` for each unknown span and nothing else when there is none.
// - `said(span, line)`: one unknown span's reason in words, naming its characters.
// - The scrollback is one `role="log"` element.
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import * as fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { builtins, read } from "./read.ts";
import { drawn, tile } from "./tile.ts";
import { fabshWindow, said } from "./window.tsx";

const SEED = 119120;

type View = {
  readonly history: ReadonlyArray<string>;
  readonly scroll: ReadonlyArray<unknown>;
  readonly programs: ReadonlyArray<string>;
};

const unescape = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

const text = (html: string) => unescape(html.replace(/<[^>]*>/g, ""));

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m === null ? null : unescape(m[1]!);
};

/** The element that opens at `start`: its tag name and the index just after its closing tag. */
const closing = (html: string, start: number): number => {
  const name = /^<([a-zA-Z0-9]+)/.exec(html.slice(start))![1]!;
  const tags = new RegExp(`<(/?)${name}\\b[^>]*?(/?)>`, "g");
  tags.lastIndex = start;
  let depth = 0;

  for (let m = tags.exec(html); m !== null; m = tags.exec(html)) {
    if (m[2] === "/") {
      continue;
    }

    depth += m[1] === "/" ? -1 : 1;

    if (depth === 0) {
      return m.index + m[0].length;
    }
  }

  return html.length;
};

const byId = (html: string, id: string): string => {
  const open = new RegExp(`<[a-z]+[^>]*\\sid="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`).exec(html);
  return open === null ? "" : text(html.slice(open.index, closing(html, open.index))).trim();
};

const inputs = (html: string) =>
  [...html.matchAll(/<input[^>]*>/g)].map((m) => m[0]).filter((t) => attr(t, "type") !== "hidden");

/** The span layer: each `data-role` element inside an `aria-hidden` element, in order. */
const layer = (html: string): ReadonlyArray<readonly [string, string]> => {
  const hidden = [...html.matchAll(/<[a-z]+[^>]*\saria-hidden="true"[^>]*>/g)];
  const out: Array<readonly [string, string]> = [];

  for (const h of hidden) {
    const inner = html.slice(h.index, closing(html, h.index));

    for (const s of inner.matchAll(/<[a-z]+[^>]*\sdata-role="([^"]*)"[^>]*>/g)) {
      const at = h.index + s.index;
      const whole = html.slice(at, closing(html, at));
      out.push([s[1]!, text(whole)]);
    }
  }

  return out;
};

const described = (html: string, field: string) =>
  (attr(field, "aria-describedby") ?? "")
    .split(/\s+/)
    .filter((id) => id !== "")
    .map((id) => byId(html, id))
    .join(" ")
    .trim();

/** The tile as the person's input leaves it: the real init, then one edit. */
const typed = (line: string) =>
  applyCell(tile, tile.init(null, {})[0], { type: "edited", text: line, cursor: line.length })[0];

const render = (view: View, own: typeof tile.model.Type) =>
  renderToStaticMarkup(
    createElement(fabshWindow.View, {
      data: view as never,
      refusal: null,
      press: () => {
        throw new Error("render pressed");
      },
      tile: own,
      send: () => {
        throw new Error("render sent");
      },
    }),
  );

const EMPTY_VIEW: View = { history: [], scroll: [], programs: [] };

const lines = fc.oneof(
  fc.constantFrom("hlep", "help", "help x", "help me now", "clear", "clear x", "history", "counter as notes2", "as"),
  fc.string({ maxLength: 120 }).map((s) => s.replace(/\n/g, " ")),
  fc
    .array(
      fc.oneof(fc.constantFrom("help", "clear", "history", "as", " ", "  "), fc.stringMatching(/^[a-z<&>"']{1,8}$/)),
      {
        maxLength: 12,
      },
    )
    .map((p) => p.join(" ")),
);

describe("L3: the span layer and the status read only read's output", () => {
  it("L3: for any line, the drawn spans are read's spans in order, and the status states exactly read's unknown spans", () => {
    const seen = { unknown: 0, clean: 0 };
    fc.assert(
      fc.property(lines, (line) => {
        const own = typed(line);
        expect(drawn(own).text).toBe(line);
        const html = render(EMPTY_VIEW, own);
        const r = read(line, { builtins: [...builtins], programs: [] });
        expect(layer(html), `the span layer of ${JSON.stringify(line)}`).toEqual(
          r.spans.map((s) => [s.role, line.slice(s.start, s.end)]),
        );
        const fields = inputs(html);
        expect(fields, "one line input").toHaveLength(1);
        const unknown = r.spans.filter((s) => s.role === "unknown");
        seen[unknown.length === 0 ? "clean" : "unknown"]++;
        expect(described(html, fields[0]!), "the status states read's reasons and nothing else").toBe(
          unknown.map((s) => said(s, line)).join(" "),
        );
      }),
      { seed: SEED, numRuns: 300 },
    );
    expect(seen.unknown).toBeGreaterThan(0);
    expect(seen.clean).toBeGreaterThan(0);
  });

  it("L3: said names the span's characters, and says each reason in its own words", () => {
    const reasons = ["no_word", "extra", "no_name", "bad_name", "ambiguous"] as const;
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{2,10}$/), (w) => {
        const line = `help ${w}`;
        const words = reasons.map((reason) => said({ start: 5, end: 5 + w.length, role: "unknown", reason }, line));

        for (const one of words) {
          expect(one).toContain(w);
        }

        expect(new Set(words).size, "two reasons said in the same words").toBe(reasons.length);
      }),
      { seed: SEED, numRuns: 50 },
    );
  });
});

describe("L16: the tile's accessible tree", () => {
  for (const line of ["hlep", "help x"]) {
    it(`scenario: L16 with ${JSON.stringify(line)}, the line is a labeled textbox, the scrollback a log, and each unknown span's reason is in the line's description (WCAG 1.4.1)`, () => {
      const html = render(
        { history: ["help"], scroll: [{ _tag: "answered", line: "help", says: ["help"] }], programs: [] },
        typed(line),
      );
      const fields = inputs(html);
      expect(fields).toHaveLength(1);
      const field = fields[0]!;
      expect(attr(field, "type") ?? "text", "the line is a text input").toBe("text");
      const label =
        attr(field, "aria-label") ??
        (attr(field, "aria-labelledby") ?? "")
          .split(/\s+/)
          .map((id) => byId(html, id))
          .join(" ")
          .trim();
      expect(label.length, "the line has an accessible name").toBeGreaterThan(0);
      expect(html.match(/\srole="log"/g)?.length ?? 0, "one scrollback log").toBe(1);
      const r = read(line, { builtins: [...builtins], programs: [] });
      const description = described(html, field);

      for (const s of r.spans.filter((s) => s.role === "unknown")) {
        expect(description).toContain(said(s, line));
      }

      const ids = (attr(field, "aria-describedby") ?? "").split(/\s+/).filter((id) => id !== "");
      expect(ids.length, "the line names its status").toBeGreaterThan(0);
      expect(
        ids.every((id) =>
          new RegExp(`\\sid="${id}"[^>]*\\saria-live="polite"|\\saria-live="polite"[^>]*\\sid="${id}"`).test(html),
        ),
        "the status is polite",
      ).toBe(true);
      // An unknown span is never color alone: its words are in the description above.
      expect(
        r.spans.some((s) => s.role === "unknown") === (description !== ""),
        "words exactly when a span is refused",
      ).toBe(true);
    });
  }
});
