import { useMachine } from "@demlik/tea/react";
import { Asked, blindDraw, sealAsk } from "@kampus/pipeline/tickets/ask";
import { AskActions, AskStatus, AskView } from "@tea-fabrika/tracker/ask-window";
import { Deferred, Effect, Schema } from "effect";
import {
  cloneElement,
  createElement,
  type Context,
  type ReactElement,
  type ReactNode,
  useContext,
  useLayoutEffect,
} from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, vi } from "vitest";
import { DRAFT, policyFor } from "../../../fixtures/ask-desk/cases.ts";
import { property, ticketNumber } from "../../../fixtures/ask-desk/property.ts";

// Observe the real tea hook, without replacing its state or dispatch behavior.
vi.mock("@demlik/tea/react", async (original) => {
  const actual = await original<typeof import("@demlik/tea/react")>();
  return { ...actual, useMachine: vi.fn(actual.useMachine) };
});

// Today's version. Plan trace: "polite status: Approved. N left." Review 3 found that a
// second Approved. is silent. Run the real React renderer and AskStatus on a small DOM host.
// The host records DOM writes, not renders: setting the same text again is not an announcement.
// This checks the DOM contract only. Speech still needs the driver's VoiceOver run.
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
    this.attributes[key] = value;
  }

  removeAttribute(key: string) {
    delete this.attributes[key];
  }

  appendChild(child: Element) {
    child.parentNode = this;
    this.childNodes.push(child);
    this.changed();
    return child;
  }

  insertBefore(child: Element, before: Element) {
    child.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    this.changed();
  }

  removeChild(child: Element) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    this.changed();
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
    this.changed();
  }

  get nodeValue() {
    return this.text;
  }

  set nodeValue(text: string) {
    this.text = text;
    this.changed();
  }

  contains(node: Element | null): boolean {
    return node === this || this.childNodes.some((child) => child.contains(node));
  }

  closest(selector: string): Element | null {
    const matches = selector.startsWith(".")
      ? this.attributes.class?.split(" ").includes(selector.slice(1))
      : this.nodeName === selector;
    return matches ? this : (this.parentNode?.closest(selector) ?? null);
  }

  focus() {
    this.ownerDocument.activeElement = this;
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

  private changed() {
    if (this.attributes.role === "status") {
      this.ownerDocument.writes++;

      if (this.textContent !== "") {
        this.ownerDocument.announcements.push(this.textContent);
      }
    } else {
      this.parentNode?.changed();
    }
  }

  findStatus(): Element | undefined {
    return this.attributes.role === "status" ? this : this.childNodes.flatMap((child) => child.findStatus() ?? [])[0];
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
  readonly hidden = false;
  writes = 0;
  readonly announcements: string[] = [];

  hasFocus() {
    return true;
  }

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

type Say = (words: string) => void;
type StatusProps = { readonly children: ReactNode; readonly left: number };
const status: (props: StatusProps) => ReactElement<{ children: ReactNode }> = AskStatus;

const mount = (left: number) => {
  const document = new Dom();
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", document.defaultView);
  // @ts-expect-error The test host supplies only the DOM calls this component uses.
  const root = createRoot(document.body);
  let say: Say | null = null;
  function Capture({ context }: { context: Context<Say | null> }) {
    const heard = useContext(context);
    // The saying leaves the component from an effect, which may reach outside it.
    useLayoutEffect(() => {
      say = heard;
    }, [heard]);
    return null;
  }
  function Subject() {
    const tree = status({ children: null, left });
    return cloneElement(
      tree,
      {},
      createElement(Capture, { context: tree.type as Context<Say | null> }),
      tree.props.children,
    );
  }
  flushSync(() => root.render(createElement(Subject)));
  return {
    document,
    announce: (words: string) => flushSync(() => say?.(words)),
    close: () => flushSync(() => root.unmount()),
  };
};

afterEach(async () => {
  // React's pending passive cleanup still reads window after an unmount.
  await new Promise<void>((resolve) => setImmediate(resolve));
  vi.unstubAllGlobals();
});

const left = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(100));
const repeats = Schema.Int.check(Schema.isGreaterThanOrEqualTo(2), Schema.isLessThanOrEqualTo(8));

// Review 5, finding 6. elm-first.md requires today's component state to live in tea.
// Plant present: AskStatus uses React state, so no tea model changes when a saying arrives.
// This observes the running model and repeated DOM announcements, not the component's source text.
property(
  "each repeated status changes its tea model and announces again",
  { left, repeats },
  async ({ left, repeats }) => {
    vi.mocked(useMachine).mockClear();
    const test = mount(left);

    try {
      expect(useMachine, "AskStatus keeps no announcement state in a tea machine").toHaveBeenCalled();

      for (let i = 0; i < repeats; i++) {
        const before = vi.mocked(useMachine).mock.results.at(-1)?.value[0];
        const writes = test.document.writes;
        test.announce("Approved.");
        await new Promise<void>((resolve) => setImmediate(resolve));
        const after = vi.mocked(useMachine).mock.results.at(-1)?.value[0];
        expect(after).not.toEqual(before);
        expect(JSON.stringify(after), "the tea model must hold the announcement").toContain("Approved.");
        expect(test.document.body.findStatus()?.textContent).toBe(`Approved. ${left} left.`);
        expect(test.document.writes).toBeGreaterThan(writes);
      }
    } finally {
      test.close();
    }
  },
);

property(
  "each accepted answer changes the live region even when its words repeat",
  { repeats },
  async ({ repeats }) => {
    const test = mount(0);

    try {
      for (let i = 0; i < repeats; i++) {
        const before = test.document.writes;
        test.announce("Approved.");
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(test.document.body.findStatus()?.textContent).toContain("Approved.");
        expect(test.document.writes, `answer ${i + 1} made no live-region DOM change`).toBeGreaterThan(before);
      }
    } finally {
      test.close();
    }
  },
);

property("an accepted answer says how many asks are left", { left }, async ({ left }) => {
  const test = mount(left);

  try {
    test.announce("Approved.");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(test.document.body.findStatus()?.textContent).toBe(`Approved. ${left} left.`);
  } finally {
    test.close();
  }
});

// Today's version, rounds 25/26, reviews 11/12, A1 and plan laws 10/24. The current product
// is the plant: a captured count minus one misses Later, arrivals and multiple saved answers.
// Run the real AskView save, tea hooks, AskStatus and React DOM. Only the outside answer reply
// and ledger poll are controlled, so either can finish first, including after the view unmounts.
const waiting = Schema.UniqueArray(Asked.fields.ask).check(Schema.isMinLength(1), Schema.isMaxLength(4));
const choice = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }));

const drain = async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  flushSync(() => {});
  await new Promise<void>((resolve) => setImmediate(resolve));
};

type TicketAsk = Asked & { readonly ticket: number };
const key = (ask: { readonly ticket: number; readonly ask: string }) => `${ask.ticket}/${ask.ask}`;

const mountAnswer = (asks: readonly TicketAsk[], selected: TicketAsk, oneTicket = false) => {
  const document = new Dom();
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", document.defaultView);
  // @ts-expect-error The test host supplies only the DOM calls the shared ask view uses.
  const root = createRoot(document.body);
  const requests = new Map<string, { started: Deferred.Deferred<void>; reply: Deferred.Deferred<null> }>();
  let queue = asks;
  let current = selected;
  const aside = new Set<string>();
  // The live asks behind frame.tsx's header count, including each ask's id. Later stays out.
  const waiting = () => queue.filter((ask) => !aside.has(key(ask)) && (!oneTicket || ask.ticket === current.ticket));
  const answers: string[] = [];
  const actions: AskActions = {
    openLane: () => {},
    command: () => undefined,
    answer: (answer) =>
      Effect.gen(function* () {
        const request = requests.get(key(answer))!;
        answers.push(key(answer));
        yield* Deferred.succeed(request.started, undefined);
        return yield* Deferred.await(request.reply);
      }),
    later: () => {},
    keys: { rec: ["y"], not: ["n"], picks: ["o"], later: ["h"] },
    blocked: () => false,
  };
  const render = () => {
    const ask = queue.find((ask) => key(ask) === key(current)) ?? queue[0];
    const live = waiting();
    // Keep ids: polling out A or B can leave the same count but change A's save result.
    const status = {
      asks: live,
      left: live.length,
      children: ask === undefined ? null : createElement(AskView, { key: key(ask), ticket: ask.ticket, ask }),
    };
    flushSync(() =>
      root.render(createElement(AskActions.Provider, { value: actions }, createElement(AskStatus, status))),
    );
  };
  render();
  return {
    document,
    answers,
    waiting,
    available: () => queue.filter((ask) => !requests.has(key(ask))),
    start: async (ask = selected, from: "list" | "later" = "list") => {
      current = ask;

      if (from === "later") {
        aside.add(key(ask));
      } else {
        aside.delete(key(ask));
      }

      render();
      const started = Deferred.makeUnsafe<void>();
      requests.set(key(ask), { started, reply: Deferred.makeUnsafe<null>() });
      const button = document.body.find(
        (node) => node.tagName === "BUTTON" && node.textContent.startsWith("Take rec"),
      )[0];
      expect(button, "the selected ask must offer its recommendation").toBeDefined();
      flushSync(() => button!.click());
      await Effect.runPromise(Deferred.await(started));
      await drain();
    },
    save: async (ask = selected) => {
      await Effect.runPromise(Deferred.succeed(requests.get(key(ask))!.reply, null));
      await drain();
    },
    select: async (ask: TicketAsk) => {
      current = ask;
      render();
      await drain();
    },
    arrive: async (ask: TicketAsk) => {
      queue = [...queue, ask];
      render();
      await drain();
    },
    poll: async (removed: readonly TicketAsk[] = [selected]) => {
      queue = queue.filter((ask) => !removed.some((removed) => key(removed) === key(ask)));
      render();
      await drain();
    },
    close: () => flushSync(() => root.unmount()),
  };
};

describe.each(["save-first", "poll-first"] as const)("answer status with %s", (order) => {
  property(
    "one answer announces once with the answered ask excluded from the remaining count",
    { waiting, choice },
    async ({ waiting, choice }) => {
      const asks = await Promise.all(
        waiting.map((ask) =>
          Effect.runPromise(sealAsk({ ...DRAFT, ask }, policyFor(ask, false, blindDraw))).then((ask) => ({
            ...ask,
            ticket: 102,
          })),
        ),
      );
      const selected = asks[choice % asks.length]!;
      const test = mountAnswer(asks, selected);

      try {
        const announcements: string[] = [];
        let writes = test.document.writes;
        const record = () => {
          if (test.document.writes === writes) {
            return;
          }

          announcements.push(test.document.body.findStatus()?.textContent ?? "");
          writes = test.document.writes;
        };
        await test.start();
        expect(test.answers).toEqual([key(selected)]);
        record();
        expect(announcements, "a pending answer must stay silent").toEqual([]);

        if (order === "poll-first") {
          await test.poll();
          record();
          expect(announcements, "a poll must not announce an unconfirmed answer").toEqual([]);
        }

        await test.save();
        record();
        await test.poll();
        record();
        // Another identical poll must not repeat or revise the saved answer's result.
        await test.poll();
        record();
        expect(announcements, `${order}: one save must announce once, counting only unanswered asks`).toEqual([
          `Approved. ${asks.length - 1} left.`,
        ]);
      } finally {
        test.close();
        await drain();
      }
    },
  );
});

const flowAsks = Schema.Array(Asked.fields.ask).check(Schema.isMinLength(2), Schema.isMaxLength(6));
const flowChoice = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 }));

const statusStep = Schema.TaggedUnion({
  answer: { choice: flowChoice, from: Schema.Literals(["list", "later"]) },
  arrive: {},
  save: { choice: flowChoice },
  // A poll may see a persisted answer before that answer's save reply reaches its view.
  poll: { choice: flowChoice, beforeReply: Schema.Boolean },
});

const steps = Schema.Array(statusStep).check(Schema.isMaxLength(24));

// Round 28, review 13: ask ids are local to a ticket. Keep same-ticket coverage and repeat
// each generated id across different tickets. The real bare-id status reducer is the plant.
// Keep review 12's three bug families in every run, with generated ask ids, targets and tails.
// The free-flow family has no prescribed prefix: any answer/arrival/save/poll order is drawn.
describe.each(["same ticket", "ticket-local ids"] as const)("ask identity: %s", (identity) => {
  describe.each([
    "Later with a live ask",
    "arrival while saving, save-first",
    "arrival while saving, poll-first",
    "two answers before polling",
    "switch tickets during saving",
    "free-flow",
  ] as const)("remaining count across %s", (flow) => {
    property(
      "every saved answer announces once, counting the current live asks without saved answers",
      { waiting: flowAsks, ticket: ticketNumber, choice: flowChoice, steps },
      async ({ waiting, ticket, choice, steps }) => {
        const asks = await Promise.all(
          waiting.map(async (id, i) => {
            const ask = identity === "same ticket" ? `${id}-${i}` : waiting[0]!;
            return {
              ...(await Effect.runPromise(sealAsk({ ...DRAFT, ask }, policyFor(ask, false, blindDraw)))),
              ticket: identity === "same ticket" ? ticket : ticket + i,
            };
          }),
        );
        const first = asks[choice % asks.length]!;
        const rest = asks.filter((ask) => ask !== first);
        const initial = flow.startsWith("arrival") ? [first] : [first, rest[0]!];
        const future = asks.filter((ask) => !initial.includes(ask));
        const test = mountAnswer(initial, first, flow === "switch tickets during saving");
        const started: TicketAsk[] = [];
        const saved = new Set<string>();
        const expected: string[] = [];
        const trace: string[] = [];
        const pending = () => started.filter((ask) => !saved.has(key(ask)));
        const check = () => {
          expect(
            test.document.announcements,
            `${flow}: ${trace.join(" -> ")}; each save must announce once with the header's live asks minus saved answers`,
          ).toEqual(expected);
          expect(test.document.body.findStatus()?.textContent).toBe(expected.at(-1) ?? "");
        };
        const answer = async (ask: TicketAsk, from: "list" | "later") => {
          trace.push(`answer ${key(ask)} from ${from}`);
          started.push(ask);
          await test.start(ask, from);
          expect(test.answers).toEqual(started.map(key));
          check();
        };
        const arrive = async () => {
          const ask = future.shift();

          if (ask === undefined) {
            return;
          }

          trace.push(`arrival ${key(ask)}`);
          await test.arrive(ask);
          check();
        };
        const save = async (ask: TicketAsk) => {
          trace.push(`save ${key(ask)}`);
          saved.add(key(ask));
          const left = test.waiting().filter((ask) => !saved.has(key(ask))).length;
          expected.push(`Approved. ${left} left.`);
          await test.save(ask);
          check();
        };
        const poll = async (beforeReply?: TicketAsk) => {
          trace.push(`poll${beforeReply === undefined ? "" : ` including ${key(beforeReply)}`}`);
          await test.poll([
            ...started.filter((ask) => saved.has(key(ask))),
            ...(beforeReply === undefined ? [] : [beforeReply]),
          ]);
          check();
        };

        try {
          switch (flow) {
            case "Later with a live ask":
              await answer(first, "later");
              await save(first);
              break;
            case "arrival while saving, save-first":
            case "arrival while saving, poll-first":
              await answer(first, "list");
              await arrive();

              if (flow === "arrival while saving, poll-first") {
                await poll(first);
              }

              await save(first);
              await poll();
              break;
            case "two answers before polling":
              await answer(first, "list");
              await answer(rest[0]!, "list");
              await save(first);
              await save(rest[0]!);
              break;
            case "switch tickets during saving":
              await answer(first, "list");
              trace.push(`select ${key(rest[0]!)}`);
              await test.select(rest[0]!);
              await save(first);
              break;
            case "free-flow":
              break;
          }

          for (const step of steps) {
            switch (step._tag) {
              case "answer": {
                const available = test.available();
                const ask = available[step.choice % available.length];

                if (ask !== undefined) {
                  await answer(ask, step.from);
                }

                break;
              }
              case "arrive":
                await arrive();
                break;
              case "save": {
                const waiting = pending();
                const ask = waiting[step.choice % waiting.length];

                if (ask !== undefined) {
                  await save(ask);
                }

                break;
              }
              case "poll": {
                const waiting = pending();
                await poll(step.beforeReply ? waiting[step.choice % waiting.length] : undefined);
                break;
              }
            }
          }

          // Deliver every outstanding reply, even for an ask a poll already unmounted.
          while (pending().length > 0) {
            await save(pending()[choice % pending().length]!);
          }

          await poll();
          await poll();
          expect(expected).toHaveLength(started.length);
        } finally {
          // A failing count must not leave detached saves waiting across generated samples.
          for (const ask of pending()) {
            await test.save(ask);
          }

          test.close();
          await drain();
        }
      },
    );
  });
});
