import { join } from "node:path";
import { applyCell } from "@demlik/tea";
import * as NodeChildProcessSpawner from "@effect/platform-node/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { Ledger, streams, writerText } from "@kampus/fabrika-old";
import { layerSqliteSync } from "@kampus/fabrika-old/sqlite";
import { type Asked, blindDraw, Rec, sealAsk, Via } from "@kampus/pipeline/tickets/ask";
import { type Fact, nameOf } from "@kampus/pipeline/tickets/ticket";
import { pullRequestsOf } from "@tea-fabrika/tracker";
import * as askWindow from "@tea-fabrika/tracker/ask-window";
import { Effect, Exit, FileSystem, Layer, Schedule, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { policyFor } from "../../../../fixtures/ask-desk/cases.ts";
import { property } from "../../../../fixtures/ask-desk/property.ts";
import { type Down } from "../link.ts";
import { readFromPage, readToPage, type ToPage } from "../messages.ts";
import { appWire } from "../wire.ts";
import { runHost } from "./run.ts";
import { pathsOf, reach } from "./socket.ts";

// Today's version. Shot S1 and review 12 of the ask desk's fix list (askdesk-review.md), across
// the real boundary: the answer the shared ask view hands its window's `answer`, sent as the page
// sends it, read by the host's own strict decoder, saved by the host on its own ledger. A host
// that refuses an answer always tells the window so; a link with no opened page cannot answer.
//
// The ask view's save interpreter is React, and these tests draw no DOM, so they read the one
// pure step it runs on a save Cmd: `answerOfSave`, the answer it hands `actions.answer`. Planned
// for the builder (made up by this test); the e2e checks P12 to P17 drive the real buttons.

const platform = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, pullRequestsOf([]))),
);

const go = <A, E>(test: Effect.Effect<A, E, Scope.Scope | Layer.Success<typeof platform>>) =>
  Effect.runPromise(test.pipe(Effect.scoped, Effect.provide(platform)));

/** Wait for `check` to answer something, five seconds at most; `null` when nothing came. */
const within = <T>(check: () => T | undefined) =>
  Effect.gen(function* () {
    for (let i = 0; i < 1000; i += 1) {
      const got = check();

      if (got !== undefined) {
        return got;
      }

      yield* Effect.sleep("5 millis");
    }

    return null;
  });

const freshHome = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "fa-" });
  return { home, paths: yield* pathsOf(home) };
});

const live = (sock: string) =>
  reach(sock).pipe(
    Effect.repeat({ until: (r) => r === "live", schedule: Schedule.spaced("5 millis") }),
    Effect.timeoutOrElse({
      duration: "5 seconds",
      orElse: () => Effect.die(`nothing answered on ${sock}`),
    }),
  );

const hostOn = (home: string) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    yield* runHost({ home, pid: process.pid }).pipe(Effect.scoped, Effect.forkIn(scope));
    const { sock } = yield* pathsOf(home);
    yield* live(sock);
    return { stop: Scope.close(scope, Exit.void) };
  });

const appOn = (sock: string) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const got: Down[] = [];
    const socket = yield* NodeSocket.makeNet({ path: sock });
    const wire = yield* appWire(socket, (m) => got.push(m)).pipe(Scope.provide(scope));
    const page = (): ToPage[] =>
      got.flatMap((m) => {
        if (m.type !== "to" || m.port !== "desk") {
          return [];
        }

        const read = readToPage(m.m);
        return read.kind === "read" ? [read.msg] : [];
      });
    const answered = (id: string) => within(() => page().find((m) => m.type === "ask_answered" && m.id === id));
    return { wire, page, answered, leave: Scope.close(scope, Exit.void) };
  });

const owner = writerText({ kind: "user", id: "owner" });
const agent = writerText({ kind: "agent", id: "plan", for: "owner" });
const ledgerOf = (home: string) => layerSqliteSync({ path: join(home, "ledger.sqlite"), tickMs: 1000 });

const write = (home: string, facts: readonly (readonly [string, Fact])[]) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    yield* ledger.register(nameOf(1), owner);

    for (const [id, fact] of facts) {
      yield* ledger.send(streams(nameOf(1)).inbox, id, {
        kind: fact.type,
        writer: fact.type === "asked" ? agent : owner,
        data: fact,
      });
    }
  }).pipe(Effect.provide(ledgerOf(home)));

const answersOn = (home: string) =>
  Effect.gen(function* () {
    const rows = yield* (yield* Ledger).readStream(streams(nameOf(1)).inbox);
    return rows.filter((r) => r.kind === "answered");
  }).pipe(Effect.provide(ledgerOf(home)));

const ASK = "a-approve-1";

const asked = sealAsk(
  {
    ask: ASK,
    for: "approve",
    step: "plan",
    repo: "acme/site",
    why: null,
    what: "Approve the plan?",
    picks: [
      { pick: "yes", does: "Take yes" },
      { pick: "no", does: "Take no" },
    ],
    rec: Rec.cases.pick.make({
      pick: "yes",
      why: "It covers the ticket",
      cost: "A small change",
      sure: 80,
    }),
    ticket: { title: "Login fails", body: "" },
    evidence: { _tag: "other", text: "The plan step wrote this." },
    until: null,
  },
  policyFor(ASK, false, blindDraw),
);

/** The save Cmd the shared ask editor gives for Take rec on `ask`, as its interpreter gets it. */
const saveFor = (ask: Asked, key = "y") => {
  const [model] = askWindow.askMachine.init(null, { ticket: 1, ask, now: 0 });
  const [, cmds] = applyCell(askWindow.askMachine, model, {
    type: "do",
    value: { _tag: "rec" },
    key,
    now: 10,
  });
  const save = cmds.find((c) => c.type === "save");

  if (save === undefined) {
    throw new Error("Take rec gave no save");
  }

  return save;
};

/** The planned pure step: the answer the ask view hands `actions.answer` for a save Cmd. */
const answerOfSave = (cmd: unknown): unknown => {
  const step: unknown = Reflect.get(askWindow, "answerOfSave");

  if (typeof step !== "function") {
    throw new Error("missing planned answerOfSave in @tea-fabrika/tracker/ask-window");
  }

  return step(cmd);
};

/** A host on a home with one filed ticket and its sealed ask, and an app attached to it. */
const seeded = (opened: boolean) =>
  Effect.gen(function* () {
    const { home, paths } = yield* freshHome;
    const ask = yield* asked;
    yield* write(home, [
      ["f1", { type: "filed", title: "Login fails", body: "" }],
      [ASK, ask],
    ]);
    const host = yield* hostOn(home);
    const app = yield* appOn(paths.sock);
    yield* app.wire.up;

    if (opened) {
      app.wire.send({ type: "page" });
      yield* within(() => app.page().find((m) => m.type === "asks"));
    }

    const sent = (id: string, value: unknown) =>
      app.wire.send({ type: "on", port: "desk", m: { type: "ask_answer", id, value } });
    const done = Effect.gen(function* () {
      yield* app.leave;
      yield* host.stop;
    });
    return { home, ask, app, sent, done };
  });

describe("ask desk S1: the window's answer is what the host decodes", () => {
  property(
    "the answer handed to the window's `answer` has no Cmd `type`, and the page's message reads",
    { key: Via.cases.window.fields.took.fields.key },
    async ({ key }) => {
      const ask = await Effect.runPromise(asked);
      const value = answerOfSave(saveFor(ask, key));
      expect(value).not.toHaveProperty("type");
      expect(value).toMatchObject({ ticket: 1, ask: ASK, answer: { _tag: "rec" }, saw: ask.saw });
      expect(readFromPage({ type: "ask_answer", id: "a1", value }).kind).toBe("read");
    },
  );
  property(
    "the Cmd as it is, `type` and all, is what the host refuses",
    { key: Via.cases.window.fields.took.fields.key },
    async ({ key }) => {
      const ask = await Effect.runPromise(asked);
      const read = readFromPage({ type: "ask_answer", id: "a1", value: saveFor(ask, key) });
      expect(read.kind).toBe("refused");
    },
  );
  // scenario: a real host, Unix socket and SQLite save, including the reply on that socket.
  it("scenario: across the real host: the window's answer is saved, and the window is told so", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const { home, ask, app, sent, done } = yield* seeded(true);
        sent("s1", answerOfSave(saveFor(ask)));
        const reply = yield* app.answered("s1");
        yield* done;
        return { reply, answers: yield* answersOn(home) };
      }),
    );
    expect(seen.reply).toEqual({ type: "ask_answered", id: "s1", why: null });
    expect(seen.answers).toHaveLength(1);
  });
  // scenario: an unreadable message travels over a real socket and must get its own reply.
  it("scenario: an answer the host cannot read still gets a reply, with why, and nothing is saved", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const { home, ask, app, sent, done } = yield* seeded(true);
        sent("s2", saveFor(ask));
        const reply = yield* app.answered("s2");
        yield* done;
        return { reply, answers: yield* answersOn(home) };
      }),
    );
    expect(seen.reply).toMatchObject({ type: "ask_answered", id: "s2", why: expect.any(String) });
    expect(seen.answers).toEqual([]);
  });
});

describe("ask desk review 12: only a link with an opened page may answer", () => {
  // scenario: a second real client connects without opening a page; its save must be refused.
  it("scenario: an answer from a link that opened no page is refused in words, and nothing is saved", async () => {
    const seen = await go(
      Effect.gen(function* () {
        const { home, ask, app, sent, done } = yield* seeded(false);
        const { type: _cmd, ...value } = saveFor(ask);
        sent("s3", value);
        const reply = yield* app.answered("s3");
        yield* done;
        return { reply, answers: yield* answersOn(home) };
      }),
    );
    expect(seen.reply).toMatchObject({ type: "ask_answered", id: "s3", why: expect.any(String) });
    expect(seen.reply?.type === "ask_answered" && seen.reply.why).not.toBe(null);
    expect(seen.answers).toEqual([]);
  });
});
