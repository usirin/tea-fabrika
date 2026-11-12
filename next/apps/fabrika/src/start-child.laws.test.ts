// P42 slice 1 (ticket 770), next/: L9 and L10 on a real local instance. Outside only: real workerd,
// sockets, object storage, alarms and the private local instance capability, set up as ticket 402's
// supervision test is. Needs ports and its own processes, so it runs in the step's container (0045).
import type { Descriptor } from "@kampus/libfabrika";
import { Writer } from "@kampus/libfabrika/access/SessionManager";
import { configureProcess, savedAlarm } from "@kampus/libfabrika/workers/runtime";
import { Effect, Schema, Scope } from "effect";
import { describe, expect, it } from "vitest";
import { childInstance, type Key, letter, PROJECT, SENT } from "./start-child.test-support.ts";

const STARTS = [{ source: "starter", to: "child" }];
/** Bounded waits tied to observable facts. */
const WAIT = 25_000;

type Fixture = Effect.Success<ReturnType<typeof childInstance>>;
// The instance's private local capability, read call by call as ticket 402's test reads it.
type Instance = Fixture["instance"] & Record<string, any>;

const pause = (ms = 50) => new Promise<void>((done) => setTimeout(done, ms));

/** Polls an observable fact. A timeout fails with the last observed state. */
const until = async <A>(label: string, look: () => Promise<A>, done: (value: A) => boolean, ms = WAIT): Promise<A> => {
  const end = Date.now() + ms;
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

  throw new Error(`${label}: no answer in ${ms} ms; last observed ${JSON.stringify(last)}`);
};

/** A real WebSocket client at the door; it keeps every pushed frame. `close` waits for the close. */
const socketAt = (instance: Instance, key: Key, tab: string) => {
  const name = `/client/${encodeURIComponent(key.fingerprint)}/${tab}`;
  const socket = new WebSocket(String(instance.url).replace("http", "ws") + name);
  const frames: any[] = [];
  const pushed: any[] = [];
  let closeCode: number | undefined;
  let serial = 0;
  socket.addEventListener("message", (event) => {
    if (event.data !== "pong") {
      const frame = JSON.parse(String(event.data));
      frames.push(frame);

      if (frame.id === undefined) {
        pushed.push(frame);
      }
    }
  });
  socket.addEventListener("close", (event) => {
    closeCode = event.code;
  });
  socket.addEventListener("error", () => {
    closeCode ??= 1006;
  });
  const next = async (match: (frame: any) => boolean) => {
    const end = Date.now() + WAIT;

    while (Date.now() < end) {
      const index = frames.findIndex(match);

      if (index >= 0) {
        return frames.splice(index, 1)[0];
      }

      if (closeCode !== undefined) {
        throw new Error(`closed ${closeCode}`);
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
  const close = async () => {
    socket.close();
    const end = Date.now() + WAIT;

    while (closeCode === undefined && Date.now() < end) {
      await pause(20);
    }
  };
  return { call, next, pushed, close };
};

/** A client acquired in the caller's scope and initialized with a signed hello; the scope closes it. */
const wire = Effect.fnUntraced(function* (instance: Instance, key: Key, tab: string) {
  const client = yield* Effect.acquireRelease(
    Effect.sync(() => socketAt(instance, key, tab)),
    (held) => Effect.promise(held.close),
  );
  yield* Effect.promise(() => hello(instance, key, tab, client));
  return { call: client.call, pushed: client.pushed };
});

const hello = async (
  instance: Instance,
  key: Key,
  tab: string,
  { call, next }: Pick<ReturnType<typeof socketAt>, "call" | "next">,
) => {
  const nonce = (await next((frame) => frame.method === "challenge")).params.nonce;
  expect(
    (
      await call("initialize", {
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
      })
    ).error,
  ).toBeUndefined();
};

type Client = Effect.Success<ReturnType<typeof wire>>;

/**
 * One real instance for the length of `test`, given back with its scope whatever `test` answers.
 * `connect` acquires a client in that scope, so each socket closes before the instance it reached.
 */
const world = (test: (fixture: Fixture, connect: (tab: string) => Promise<Client>) => Promise<void>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* childInstance(STARTS);
        const scope = yield* Effect.scope;
        const connect = (tab: string) =>
          Effect.runPromise(Scope.provide(scope)(wire(fixture.instance as Instance, fixture.key, tab)));
        yield* Effect.promise(() => test(fixture, connect));
      }),
    ),
  );

const helpers = ({ instance, hashes, from }: Fixture) => {
  const project = () => (instance as Instance).project(PROJECT);
  return {
    start: async (name: string, program: "starter" | "child") => {
      const started = await Reflect.get(project(), "start")(
        { _tag: "first", id: `start-${name}`, name, code: { program, hash: hashes[program] } },
        from,
      );
      return Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(started).process;
    },
    facts: async (stream: string) =>
      ((await project().read(stream, 0, "audit")) as Array<any>).map((row) => ({ ...row.body, _tag: row._tag })),
    live: async (name: string): Promise<string | undefined> =>
      ((await project().info()) as Array<any>).find((row) => row.name === name)?.process,
  };
};

describe("P42 slice 1: a code start on the real Worker path", () => {
  // scenario: L10, A7. One storage cut between saving the first wake and setting its alarm.
  // The real-instance check below proves execution; this checks the public configure handoff's retry.
  it("scenario: L10: a retry after the first alarm write fails arms the saved wake", async () => {
    const values = new Map<string, unknown>();
    let armed: number | undefined;
    let fail = true;
    const ctx = {
      storage: {
        get: async (key: string) => values.get(key),
        put: async (key: string, value: unknown) => {
          values.set(key, value);
        },
        setAlarm: async (at: number) => {
          if (fail) {
            fail = false;
            throw new Error("first alarm write failed");
          }

          armed = at;
        },
      },
    } as Parameters<typeof configureProcess>[0];
    const descriptor: Descriptor = {
      id: "process_0000000000e008000000000001",
      name: "child:alarm",
      program: "child",
      build: "p42-alarm",
      owner: Writer.cases.person.make({ key: "SHA256:test", for: "person_01m6v5270hf3c8x2q7w9z4k5mn" }),
    };
    const first = await Effect.runPromise(Effect.result(configureProcess(ctx, descriptor, true)));
    expect(first._tag).toBe("Failure");
    const wake = await Effect.runPromise(savedAlarm(ctx));
    expect(wake).toBeTypeOf("number");
    expect(armed).toBeUndefined();
    await Effect.runPromise(configureProcess(ctx, descriptor, true));
    expect(armed, "L10: retry arms the first wake even though its saved value already exists").toBe(wake);
    expect(values.get("descriptor")).toEqual(descriptor);
    expect(await Effect.runPromise(savedAlarm(ctx))).toBe(wake);
  });

  // scenario: L9. Only the real project holds the client list a notify would reach, so one real
  // instance with one connected client is the check; generated Node laws cannot see that list.
  it("scenario: L9: a code start sends nothing to any client: no view, no notify, no focus", async () => {
    await world(async (fixture, connect) => {
      const { start, live } = helpers(fixture);
      const starter = await start("starter:1", "starter");
      const client = await connect("children");

      const quiet = client.pushed.length;
      const sent = await client.call(
        "process.send",
        letter(starter, "start-1", { type: "start", program: "child", name: "child:1", input: { type: "inc" } }),
      );
      expect(sent, "the starter takes the letter").toMatchObject({ result: { _tag: "accepted" } });
      const child = await until(
        "the child is live",
        () => live("child:1"),
        (pid) => pid !== undefined,
      );
      // Settle: anything the start would push has had its turn.
      await pause(1_000);
      const after = client.pushed.slice(quiet);
      expect(
        after.filter(
          (frame) => JSON.stringify(frame).includes(String(child)) || JSON.stringify(frame).includes("child:1"),
        ),
        "L9: no frame about the child reaches any client",
      ).toEqual([]);
      expect(
        after.filter((frame) => /notify|view|focus|open/i.test(String(frame.method))),
        "L9: a code start opens, notifies and focuses nothing",
      ).toEqual([]);
    });
  });

  // scenario: L10. Only a real object proves the descriptor and configure path: a child started by
  // code must run, and a throw must restart it in its own object as the boot's child restarts.
  it("scenario: L10: a started child runs, and a throw restarts it in its own object while others keep their counts", async () => {
    await world(async (fixture, connect) => {
      const { start, live, facts } = helpers(fixture);
      const starter = await start("starter:1", "starter");
      const other = await start("child:boot", "child");
      const client = await connect("children");

      await client.call(
        "process.send",
        letter(starter, "start-1", { type: "start", program: "child", name: "child:1", input: { type: "inc" } }),
      );
      const first = String(
        await until(
          "the started child is live",
          () => live("child:1"),
          (pid) => pid !== undefined,
        ),
      );
      // It runs: its first letter was stepped, and a door letter steps it again.
      const view = await until(
        "the child stepped its first letter",
        () => client.call("view.open", { pid: first }),
        (frame) => frame.result?.view?.count === 1,
      );
      expect(view, "L10: the child's first letter is its input").toMatchObject({ result: { view: { count: 1 } } });
      expect(await client.call("process.send", letter(first, "inc-1", { type: "inc" }))).toMatchObject({
        result: { _tag: "accepted" },
      });

      // A throw restarts it: one restarted fact naming the old life, in the child's own name.
      await client.call("process.send", letter(first, "throw-1", { type: "throw" }));
      const [restarted] = await until(
        "one restarted fact after the child's throw",
        async () => (await facts("processes/child:1")).filter((fact) => fact._tag === "restarted"),
        (rows) => rows.length >= 1,
      );
      expect(restarted, "L10: P34 restarts the child in its own name").toMatchObject({
        after: first,
        name: "child:1",
      });
      const second = await until(
        "the successor is live",
        () => live("child:1"),
        (pid) => pid !== undefined && pid !== first,
      );
      expect(second).toBe(restarted?.["process"]);

      // Its starter and the other program keep their lives and their counts.
      expect(await live("starter:1"), "L10: the starter keeps its life").toBe(starter);
      expect(await live("child:boot"), "L10: another program keeps its life").toBe(other);
      expect(
        (await facts("processes/starter:1")).filter((fact) => fact._tag === "restarted"),
        "L10: the starter's restarts are unchanged",
      ).toEqual([]);
      expect(
        (await facts("processes/child:boot")).filter((fact) => fact._tag === "restarted"),
        "L10: another program's restarts are unchanged",
      ).toEqual([]);
    });
  });
});
