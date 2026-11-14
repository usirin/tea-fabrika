// fabsh slice 2a, next/: L21 and L28 of the approved plan (docs/plan/lanes/fabsh-PLAN.md, "Laws",
// amendments A5 and A6) on a real local instance with no start grants at all, as the app starts one
// (`dev.ts` hands `localInstance` no `starts`). Real workerd, sockets, object storage and alarms, set
// up by `start-child.test-support.ts` as the desk's start laws are; it needs ports and its own
// processes, so it runs in the step's container (0045). Written before slice 2a's build; until it
// lands, L28 fails on its behavior: fabsh never learns which programs it can start, so a program
// line is refused. L21 holds today and guards the rule.
//
// The shape these laws hold the build to:
// - L21: no start grant names `fabrika/fabsh` as its source in what the app hands the instance. A
//   process of that program asking for a start with no member's letter behind it (a timer step) is
//   decided by the host's grants alone, and answers `forbidden` (0170).
// - L28: fabsh learns the names it can start from the runner's `programs` built-in on its own, before
//   a person's first line (its view's `programs`). Then each line a member submits starts its
//   program through `start_child`, checked against that member (`mayStart`), with no grant: the
//   scrollback entry is `started {line, process, name, fresh}`, and the process is live.
// - Not written: L28's second half, "a line whose writer's key was removed before its step shows
//   `forbidden`". On a real instance the step and its start run inside the letter's own delivery,
//   before `process.send` answers, so nothing outside can remove the key between the input and the
//   step; the report sends this half back to the plan.
import { Effect, Schema, Scope } from "effect";
import { describe, expect, it, vi } from "vitest";
import { childInstance, type Key, letter, PROJECT, SENT } from "./start-child.test-support.ts";

vi.mock("virtual:fabrika-built", () => ({
  programs: {
    "fabrika/counter": { hash: "counter-test", source: "counter" },
    "fabrika/checklist": { hash: "checklist-test", source: "checklist" },
    "fabrika/fabsh": { hash: "fabsh-test", source: "fabsh" },
    "p42/child": { hash: "child-test", source: "child" },
  },
  assets: {},
}));

/** Bounded waits tied to observable facts. */
const WAIT = 25_000;

type Fixture = Effect.Success<ReturnType<typeof childInstance>>;
// The instance's private local capability, read call by call as the desk's start laws read it.
type Instance = Fixture["instance"] & Record<string, any>;

const pause = (ms = 50) => new Promise<void>((done) => setTimeout(done, ms));

/** Polls an observable fact. A timeout fails with the last observed state. */
const until = async <A>(label: string, look: () => Promise<A>, done: (value: A) => boolean): Promise<A> => {
  const end = Date.now() + WAIT;
  let last: { value: A } | { error: string } | null = null;

  while (Date.now() < end) {
    try {
      const value = await look();
      last = { value };

      if (done(value)) {
        return value;
      }
    } catch (error) {
      last = { error: String(error) };
    }

    await pause();
  }

  throw new Error(`${label}: no answer in ${WAIT} ms; last observed ${JSON.stringify(last)}`);
};

/** A real WebSocket client at the door, signed in with the founder's key; the scope closes it. */
const connect = Effect.fnUntraced(function* (instance: Instance, key: Key, tab: string) {
  const frames: any[] = [];
  const socket = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const opened = new WebSocket(
        `${String(instance.url).replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`,
      );
      opened.addEventListener("message", (event) => {
        if (event.data !== "pong") {
          frames.push(JSON.parse(String(event.data)));
        }
      });
      return opened;
    }),
    (opened) => Effect.sync(() => opened.close()),
  );
  let serial = 0;
  const next = async (match: (frame: any) => boolean) => {
    const end = Date.now() + WAIT;

    while (Date.now() < end) {
      const index = frames.findIndex(match);

      if (index >= 0) {
        return frames.splice(index, 1)[0];
      }

      await pause(20);
    }

    throw new Error(`no frame in ${WAIT} ms; last frames ${JSON.stringify(frames.slice(-3))}`);
  };
  const call = async (method: string, params: unknown) => {
    const id = ++serial;
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return next((frame) => frame.id === id);
  };
  yield* Effect.promise(async () => {
    const nonce = (await next((frame) => frame.method === "challenge")).params.nonce;
    const hello = await call("initialize", {
      versions: [1],
      has: ["seal"],
      ping: "30s",
      key: key.raw,
      tab,
      nonce,
      platform: "headless",
      os: "linux",
      sentAt: SENT,
      signed: key.proof(`fabrika-hello\n${instance.url}\n${tab}\n${nonce}`),
    });
    expect(hello.error, "the founder's hello is taken").toBeUndefined();
  });
  return { call };
});

type Client = Effect.Success<ReturnType<typeof connect>>;

/** One real instance with no start grants for the length of `test`, given back with its scope. */
const world = (
  test: (fixture: Fixture, client: () => Promise<Client>) => Promise<void>,
  extra: Readonly<Record<string, string>> = {},
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* childInstance(undefined, extra);
        const scope = yield* Effect.scope;
        const client = () =>
          Effect.runPromise(Scope.provide(scope)(connect(fixture.instance as Instance, fixture.key, "fabsh-start")));
        yield* Effect.promise(() => test(fixture, client));
      }),
    ),
  );

const live = async (instance: Instance, name: string): Promise<string | undefined> =>
  ((await instance.project(PROJECT).info()) as Array<any>).find((row) => row.name === name)?.process;

/** A stand-in for `fabrika/fabsh` that asks for one start from its first timer, a step with no
 *  member's letter behind it, and keeps every answer it was told. */
const loneStarter = [
  'import {Machine} from "@demlik/tea/effect";',
  'import {Schema} from "effect";',
  'import {startChild} from "@kampus/libfabrika/runtime/StartChild";',
  "const Model = Schema.Struct({asked: Schema.Boolean, told: Schema.Array(Schema.Json)});",
  'const Msg = Schema.Union([Schema.Struct({type: Schema.Literal("timer"), at: Schema.Number, arrivedAt: Schema.optionalKey(Schema.Number)}), Schema.Struct({type: Schema.Literal("submitted"), line: Schema.String})]);',
  'const machine = Machine.make({model: Model, msg: Msg, cmds: [startChild], init: (loaded) => [loaded ?? {asked: false, told: []}, []], update: {timer: (s) => s.asked ? [s, []] : [{...s, asked: true}, [startChild({program: "fabrika/counter", name: "l21:1"})]], submitted: (s) => [s, []], start_child_ok: (s, m) => [{...s, told: [...s.told, m.value]}, []], start_child_err: (s, m) => [{...s, told: [...s.told, m.reason]}, []]}});',
  'export const program = {name: "fabrika/fabsh", machine, state: {v: 1, schema: Model, upgrades: []}, msg: Msg, view: {data: Model, select: (s) => s}, refuse: () => null, inputs: {submitted: {_tag: "write", schema: Msg, description: "A line", personOnly: true}}, outputs: {}, writes: {}, wake: (s) => (s.asked ? null : 0)};',
].join("\n");

const Entry = Schema.Struct({ _tag: Schema.String, line: Schema.String });

describe("fabsh slice 2a on a real instance with no start grants", () => {
  // scenario: L21. Only the host's own wiring holds the start grants, and no program can read them, so
  // one instance started as the app starts it is the check: a fabsh process's start with no
  // member's letter behind it is decided by those grants, and they give fabsh nothing.
  it("scenario: L21: fabsh holds no start permission: with no member's letter behind it, its start is forbidden", async () => {
    await world(
      async ({ instance }) => {
        const pid = await until(
          "fabsh:1 is live",
          () => live(instance as Instance, "fabsh:1"),
          (p) => p !== undefined,
        );
        const opened = await until(
          "the stand-in was told its start's answer",
          () => (instance as Instance).process(pid).open("audit") as Promise<any>,
          (o) => (o?.view?.told?.length ?? 0) > 0,
        );
        expect(opened.view.told, "L21: no grant lets a fabsh process start a program on its own").toEqual([
          "forbidden",
        ]);
        expect(await live(instance as Instance, "l21:1"), "L21: nothing was started").toBeUndefined();
      },
      { "fabrika/fabsh": loneStarter },
    );
  });

  // scenario: L28. Only the real door stamps a line's writer where the runner reads it, and only a
  // real instance's loader answers `programs`; the generated laws walk fabsh's own steps in
  // `next/programs/fabsh/src/start.laws.test.ts`.
  it("scenario: L28: with starts empty, the founder's lines start any program, and each shows started in the scrollback", async () => {
    await world(async ({ instance }, client) => {
      const fabsh = await until(
        "fabsh:1 is live",
        () => live(instance as Instance, "fabsh:1"),
        (p) => p !== undefined,
      );
      const founder = await client();
      const view = async () => (await founder.call("view.open", { pid: fabsh })).result?.view;
      const learned = await until(
        "fabsh learned what it can start before any line",
        view,
        (v) => (v?.programs?.length ?? 0) > 0,
      );
      expect(learned.programs, "L28: fabsh knows the app's programs").toEqual(
        expect.arrayContaining(["fabrika/counter", "fabrika/checklist", "fabrika/fabsh"]),
      );
      const counter = await live(instance as Instance, "counter:1");
      const lines = [
        { line: "counter", name: "counter:1", fresh: false },
        { line: "counter as l28-counter", name: "l28-counter", fresh: true },
        { line: "fabrika/checklist as l28-list", name: "l28-list", fresh: true },
        { line: "p42/child as l28-child", name: "l28-child", fresh: true },
        { line: "fabsh as l28-sh", name: "l28-sh", fresh: true },
      ];

      for (const [n, { line }] of lines.entries()) {
        expect(
          await founder.call("process.send", letter(fabsh, `l28-${n}`, { type: "submitted", line })),
          `fabsh takes ${JSON.stringify(line)}`,
        ).toMatchObject({ result: { _tag: "accepted" } });
      }

      const settled = await until("every line's start was answered", view, (v) =>
        lines.every(({ line }) =>
          (v?.scroll ?? []).some((e: unknown) => Schema.is(Entry)(e) && e.line === line && e._tag !== "starting"),
        ),
      );

      for (const { line, name, fresh } of lines) {
        const process = name === "counter:1" ? counter : await live(instance as Instance, name);
        expect(process, `L28: ${name} is live`).toBeDefined();
        expect(
          settled.scroll.filter((e: { line: string }) => e.line === line),
          `L28: ${JSON.stringify(line)} started with no grant`,
        ).toEqual([{ _tag: "started", line, process, name, fresh }]);
      }
    });
  });
});
