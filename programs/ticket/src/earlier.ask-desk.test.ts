import { Answer, blindDraw, sealAsk } from "@kampus/pipeline/tickets/ask";
import type { Asked } from "@kampus/pipeline/tickets/ask";
import { Entry, fold, type Ticket } from "@kampus/pipeline/tickets/ticket";
import { Effect, Schema } from "effect";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, vi } from "vitest";
import { AGENT, DRAFT, FILED, NOW, OWNER, policyFor, TOOK } from "../../../fixtures/ask-desk/cases.ts";
import { property, ticketNumber } from "../../../fixtures/ask-desk/property.ts";
import { pageOf, type Shown } from "./view.ts";
import { TicketWindow } from "./window.tsx";

// Ticket 102, ask desk PR 1, plan property 22 and its 2026-11-09 amendment. On #118 an answered
// ask whose question equals the open ask's reads `answered "Do you approve plan version 2?": approve`,
// as if the bar's ask were already answered. The law, over generated timelines: while the bar
// holds an open ask, no Activity row of another (answered or withdrawn) ask with the same question
// reads as that open ask. Such a row names itself an earlier ask (its text carries "earlier");
// rows whose question differs keep today's words. Rendered through the real TicketWindow (rows.ts
// saidOf and window.tsx rowsBeside together), on the DOM host activity.ask-desk.test.ts uses.
class Element {
  readonly nodeType: number;
  readonly tagName: string;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly style = {};
  readonly attributes: Record<string, string> = {};
  readonly childNodes: Element[] = [];
  readonly listeners = new Map<string, ((event: unknown) => void)[]>();
  parentNode: Element | null = null;

  constructor(
    readonly nodeName: string,
    readonly ownerDocument: Dom,
    private text = "",
  ) {
    this.nodeType = nodeName === "#text" ? 3 : 1;
    this.tagName = nodeName.toUpperCase();
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener() {}

  setAttribute(key: string, value: string) {
    this.attributes[key] = String(value);
  }

  removeAttribute(key: string) {
    delete this.attributes[key];
  }

  appendChild(child: Element) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  insertBefore(child: Element, before: Element) {
    child.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
  }

  removeChild(child: Element) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get textContent(): string {
    return this.text + this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(text: string) {
    this.text = text;
    this.childNodes.splice(0);
  }

  get nodeValue() {
    return this.text;
  }

  set nodeValue(text: string) {
    this.text = text;
  }

  find(matches: (node: Element) => boolean): Element[] {
    return [...(matches(this) ? [this] : []), ...this.childNodes.flatMap((c) => c.find(matches))];
  }

  // AskView looks for an enclosing tile; this host has none.
  closest() {
    return null;
  }

  focus() {}
  blur() {}

  contains() {
    return false;
  }

  click() {
    this.bubbleClick({ type: "click", target: this, button: 0, bubbles: true });
  }

  private bubbleClick(event: unknown) {
    for (const listener of this.listeners.get("click") ?? []) {
      listener(event);
    }

    this.parentNode?.bubbleClick(event);
  }
}

class Dom {
  readonly nodeType = 9;
  readonly documentElement = { namespaceURI: "http://www.w3.org/1999/xhtml" };

  readonly defaultView = {
    HTMLElement: Element,
    HTMLIFrameElement: class {},
    addEventListener() {},
    removeEventListener() {},
  };

  readonly body = new Element("body", this);
  activeElement = this.body;
  addEventListener() {}
  removeEventListener() {}

  hasFocus() {
    return true;
  }

  createElement(name: string) {
    return new Element(name, this);
  }

  createElementNS(_namespace: string, name: string) {
    return this.createElement(name);
  }

  createTextNode(text: string) {
    return new Element("#text", this, text);
  }
}

const ticketOf = (facts: readonly { readonly type: string }[]): Ticket => {
  const entries = facts.map((fact, i) =>
    Schema.decodeUnknownSync(Entry)({
      pos: i + 1,
      ticket: 102,
      by: fact.type === "asked" || fact.type === "withdrawn" || fact.type === "started" ? AGENT : OWNER,
      at: NOW - 60_000 + i,
      fact,
    }),
  );
  const result = fold([], entries);
  expect(result.problems).toEqual([]);
  const ticket = result.tickets[0];

  if (ticket === undefined) {
    throw new Error("no ticket after filing");
  }

  return ticket;
};

const mount = (ticket: Ticket) => {
  const document = new Dom();
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", document.defaultView);
  // @ts-expect-error The test host supplies only the DOM calls this window uses.
  const root = createRoot(document.body);
  const view: Shown = {
    ready: true,
    number: ticket.number,
    page: pageOf(ticket, NOW, [ticket]),
    saving: [],
    failed: null,
    unreachable: null,
    now: NOW,
  };
  flushSync(() => root.render(createElement(TicketWindow, { view, send: () => {} })));
  return {
    body: document.body,
    rows: () => document.body.find((e) => e.attributes.class === "act-r"),
    close: () => flushSync(() => root.unmount()),
  };
};

afterEach(async () => {
  // React's pending passive cleanup still reads window after an unmount.
  await new Promise<void>((resolve) => setImmediate(resolve));
  vi.unstubAllGlobals();
});

const word = Schema.String.check(Schema.isPattern(/^[a-z]{1,20}$/));

const inputs = {
  n: ticketNumber,
  word,
  other: word,
  count: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 4 })),
  choice: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
  ending: Schema.Literals(["answered", "withdrawn"]),
  order: Schema.Literals(["same first", "other first"]),
};

const sealed = (n: number, id: string, what: string, count: number) => {
  const ask = `a-${id}-${n}`;
  return Effect.runPromise(
    sealAsk(
      {
        ...DRAFT,
        ask,
        for: "step",
        what,
        picks: ["approve", "no", "split", "stop"].slice(0, count).map((pick, i) => ({
          pick,
          does: `Choose ${pick} option ${i + 1}`,
        })),
        rec: DRAFT.rec,
        evidence: { _tag: "other", text: `Read the change to ${what}.` },
      },
      policyFor(ask, false, blindDraw),
    ),
  );
};

const answered = (ask: Asked, choice: number) => {
  const pick = ask.shows.picks[choice % ask.shows.picks.length]!.pick;
  const answer =
    pick === (ask.shows.rec._tag === "pick" ? ask.shows.rec.pick : null)
      ? Answer.cases.rec.make({})
      : Answer.cases.against.make({ pick, note: `Please choose ${pick} instead.` });
  return {
    type: "answered",
    format: 1,
    ask: ask.ask,
    answer,
    saw: ask.saw,
    via: { _tag: "window", took: TOOK },
  };
};

property(
  "an earlier ask with the open ask's question names itself earlier; other rows keep their words",
  inputs,
  async (input) => {
    const question = `Do you approve plan version ${input.word}?`;
    const different = `Do you approve plan version ${input.word} again, ${input.other}?`;
    const earlier = await sealed(input.n, "earlier", question, input.count);
    const unlike = await sealed(input.n, "unlike", different, input.count);
    const open = await sealed(input.n, "open", question, input.count);
    const end = (ask: Asked) =>
      input.ending === "answered" ? answered(ask, input.choice) : { type: "withdrawn", ask: ask.ask, why: "expired" };
    const earlierEnd = end(earlier);
    const unlikeEnd = end(unlike);
    const past =
      input.order === "same first"
        ? [earlier, earlierEnd, unlike, unlikeEnd]
        : [unlike, unlikeEnd, earlier, earlierEnd];
    const facts = [FILED, ...past, open];
    const ticket = ticketOf(facts);
    const posOf = (fact: unknown) => facts.indexOf(fact as never) + 1;
    const test = mount(ticket);

    try {
      const rows = test.rows();
      const rowAt = (fact: unknown) => rows.find((r) => r.attributes["aria-controls"] === `fact-${posOf(fact)}`);
      // Today's rule, kept: the bar is the open ask, so its own asked row is not repeated.
      expect(rowAt(open), "the bar's own asked row stays out of Activity").toBeUndefined();

      for (const fact of [earlier, earlierEnd]) {
        const row = rowAt(fact);
        expect(row, "an earlier ask's row stays in Activity").toBeDefined();
        expect(row!.textContent, `reads as the open ask: ${row!.textContent}`).toMatch(/earlier/i);
      }

      const words = {
        asked: `asks you: ${different}`,
        answered: `answered "${different}": `,
        withdrawn: `withdrew "${different}"`,
      } as const;

      for (const fact of [unlike, unlikeEnd]) {
        const row = rowAt(fact);
        expect(row, "a row of a different question stays").toBeDefined();
        expect(row!.textContent).not.toMatch(/earlier/i);
        expect(row!.textContent).toContain(words[(fact as { type: "asked" }).type]);
      }
    } finally {
      test.close();
    }
  },
);
