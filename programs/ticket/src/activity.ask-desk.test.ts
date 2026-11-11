import type { Asked } from "@kampus/pipeline/tickets/ask";
import { Answer, blindDraw, sealAsk } from "@kampus/pipeline/tickets/ask";
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

// Today's version, ticket 102, round 23, review 9. This small DOM host runs the real React
// renderer and delegated click handler, as ask-status.ask-desk.test.ts does for announcements.
// It supplies DOM operations only. No product component, hook, state or answer is replaced.
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
  readonly defaultView = { HTMLElement: Element, HTMLIFrameElement: class {} };
  readonly body = new Element("body", this);
  activeElement = this.body;
  addEventListener() {}
  removeEventListener() {}

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
  count: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 4 })),
  choice: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
  rec: Schema.Literals(["shown", "blind", "none"]),
};

const generatedAsk = (input: { n: number; word: string; count: number; rec: string }) => {
  const ask = `a-approve-${input.n}`;
  return Effect.runPromise(
    sealAsk(
      {
        ...DRAFT,
        ask,
        for: "step",
        what: `Should we change ${input.word}?`,
        picks: ["approve", "no", "split", "stop"].slice(0, input.count).map((pick, i) => ({
          pick,
          does: `Choose ${input.word} option ${i + 1}`,
        })),
        rec: input.rec === "none" ? { _tag: "none", why: "No recommendation recorded" } : DRAFT.rec,
        evidence: { _tag: "other", text: `Read the change to ${input.word}.` },
      },
      policyFor(ask, input.rec === "blind", blindDraw),
    ),
  );
};

const answered = (ask: Asked, choice: number) => {
  const pick = ask.shows.picks[choice % ask.shows.picks.length]!.pick;
  const answer =
    ask.shows.rec._tag !== "pick"
      ? Answer.cases.chose.make({ pick })
      : pick === ask.shows.rec.pick
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

// Plant present, review 9, machine.ts:616: openedOf removes sealed asks from the timeline but
// keeps their Activity rows. A real click must have the question and every pick to open.
property("every Activity ask row opens its question and picks, answered or not", inputs, async (input) => {
  const ask = await generatedAsk(input);

  for (const ending of [
    [answered(ask, input.choice)],
    [{ type: "withdrawn", ask: ask.ask, why: "expired" }],
    [{ type: "closed" }],
  ]) {
    const ticket = ticketOf([FILED, ask, ...ending]);
    const test = mount(ticket);

    try {
      const asks = test.rows().filter((row) => row.textContent.includes(`asks you: ${ask.shows.what}`));
      expect(asks).toHaveLength(1);

      for (const row of asks) {
        expect(row.attributes["aria-expanded"]).toBe("false");
        flushSync(() => row.click());
        expect(row.attributes["aria-expanded"]).toBe("true");
        const details = test.body.find((e) => e.attributes.id === row.attributes["aria-controls"]);
        expect(details, "the ask row opened with no details after its answer").toHaveLength(1);
        expect(details[0]!.textContent).toContain(ask.shows.what);

        for (const pick of ask.shows.picks) {
          expect(details[0]!.textContent).toContain(pick.pick);
          expect(details[0]!.textContent).toContain(pick.does);
        }
      }
    } finally {
      test.close();
    }
  }
});

// Plant present, review 9, rows.ts:134: a withdrawal says `withdrew ask <id>`. Legacy
// replacement writes these in normal use. Inspect all row text, including its quieter part.
property(
  "Activity rows name questions in words and never print machine ids, including withdrawals and replacements",
  inputs,
  async (input) => {
    const ask = await generatedAsk(input);
    const legacy = {
      type: "asked",
      ask: `a-legacy-${input.n}`,
      what: ask.shows.what,
      picks: ["approve", "no"],
    };
    const run = { type: "started", run: `r-build-${input.n}`, stage: "build", task: null, log: null };
    const replacement = await Effect.runPromise(
      sealAsk({
        ...DRAFT,
        ask: `a-replacement-${input.n}`,
        replaces: legacy.ask,
        what: ask.shows.what,
      }),
    );

    for (const facts of [
      [ask],
      [ask, answered(ask, input.choice)],
      [ask, { type: "withdrawn", ask: ask.ask, why: "expired" }],
      [
        legacy,
        replacement,
        { type: "withdrawn", ask: legacy.ask, why: "changed" },
        answered(replacement, input.choice),
      ],
    ]) {
      // A closed ticket puts every ask in Activity, including an unanswered one.
      const ticket = ticketOf([FILED, run, ...facts, { type: "closed" }]);
      const test = mount(ticket);

      try {
        const rows = test.rows();
        expect(rows.length).toBeGreaterThan(0);

        for (const row of rows) {
          for (const id of [ask.ask, legacy.ask, replacement.ask, run.run]) {
            expect(row.textContent, `Activity printed machine id ${id}`).not.toContain(id);
          }
        }

        for (const entry of ticket.timeline.filter((e) => e.fact.type === "withdrawn")) {
          const row = rows.find((r) => r.attributes["aria-controls"] === `fact-${entry.pos}`);
          expect(row, "the withdrawal must remain in Activity").toBeDefined();
          expect(row!.textContent).toContain(ask.shows.what);
        }
      } finally {
        test.close();
      }
    }
  },
);
