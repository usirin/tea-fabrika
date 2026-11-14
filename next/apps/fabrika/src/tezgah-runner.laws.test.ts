// Desk S2a, next/ (the desk program fabrika/tezgah, ticket named by its title): laws L8 (its real
// half, `@kampus/tezgah/RunnerTest`'s suite) and L12 of the approved plan, on a real local
// instance: the app's own build with the app's table, real workerd through Alchemy, real sockets.
// A program may import only the library's front, so the instance, its door and its process table
// are wired here. Written before tezgah is in the table, before the boot starts it and before the
// Worker wires `stop_child`. Needs ports and its own processes, so it runs in the step's container
// (0045) and in CI, before the slice's first review (0178).
//
// The shape these laws hold the build to, from the plan (the build may add more):
// - The app's table lists `fabrika/tezgah`, and the brain starts one tezgah process per person at
//   boot, for the founder, named `tezgah:` and then the person (the plan's "Where tezgah runs").
//   The law finds it in the process table by that lead, so how the person's id is spelled in a
//   process name is the build's.
// - Workspace 1's first tile shows the boot list's `checklist:1`; a split's new tile shows a new
//   process tezgah starts; a close of a tile tezgah started stops its process with `shutdown`
//   through the Worker's `stop_child` (plan amendment, 2026-11-14).
// - `Headless.start` takes `desk: {workspace}`. A window started with a desk reads
//   `processes/tezgah:<person>` once admitted, with the person from the door's admission, opens
//   tezgah's view, attaches its workspace itself, and shows the workspace's tiles, each tile's
//   process view opened, in place of a fixed list.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { NodeServices } from "@effect/platform-node";
import { checklistView } from "@kampus/checklist";
import { Id } from "@kampus/libfabrika";
import * as Headless from "@kampus/libfabrika/client/Headless";
import { windowMachineFor } from "@kampus/libfabrika/client/WindowMachine";
import { ClientKey, type Identity } from "@kampus/libfabrika/transport/ClientKey";
import { ClientRows } from "@kampus/libfabrika/transport/ClientRows";
import { KeyLine } from "@kampus/libfabrika/transport/Sshsig";
import * as RunnerTest from "@kampus/tezgah/RunnerTest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { describe, expect, it } from "vitest";
import { build } from "./build.ts";
import { localInstance } from "./local-instance.ts";
import { heldPort } from "./port.test-support.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const PROJECT = "desk-s2a";
const SENT = "2026-11-14T04:00:00.000Z";
const WAIT = 60_000;
/** A door frame's JSON text. */
const Json = Schema.fromJsonString(Schema.Unknown);
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

const typeId = (prefix: string, n: number): string => {
  let uuid = (BigInt(n) << 80n) | (7n << 76n) | (2n << 62n);
  let suffix = "";

  for (let i = 0; i < 26; i++) {
    suffix = ALPHABET[Number(uuid & 31n)] + suffix;
    uuid >>= 5n;
  }

  return `${prefix}_${suffix}`;
};

const field = (value: Buffer | string) => {
  const body = Buffer.from(value);
  const n = Buffer.alloc(4);
  n.writeUInt32BE(body.length);
  return Buffer.concat([n, body]);
};

/** A fresh SSH identity: its public line and raw key, its fingerprint, its door proof and its signer. */
const identity = () => {
  const pair = generateKeyPairSync("ed25519");
  const raw = pair.publicKey.export({ format: "jwk" }).x ?? "";
  const bytes = Buffer.from(raw, "base64url");
  const blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
  return {
    raw,
    line: `ssh-ed25519 ${blob.toString("base64")}`,
    fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`,
    sign: (data: Uint8Array) => new Uint8Array(sign(null, data, pair.privateKey)),
    proof: (text: string) => {
      const payload = Buffer.concat([
        Buffer.from("SSHSIG"),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(createHash("sha512").update(text).digest()),
      ]);
      const v = Buffer.alloc(4);
      v.writeUInt32BE(1);
      const packet = Buffer.concat([
        Buffer.from("SSHSIG"),
        v,
        field(blob),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(Buffer.concat([field("ssh-ed25519"), field(sign(null, payload, pair.privateKey))])),
      ]);
      const lines = packet.toString("base64").match(/.{1,70}/g) ?? [];
      return `-----BEGIN SSH SIGNATURE-----\n${lines.join("\n")}\n-----END SSH SIGNATURE-----\n`;
    },
  };
};

type Key = ReturnType<typeof identity>;
// The instance's private local capability, read call by call as ticket 402's test reads it.
type Instance = Record<string, any>;

const pause = (ms = 100) => new Promise<void>((done) => setTimeout(done, ms));

/** Polls an observable fact; a timeout fails with the last observed value. */
const until = async <A>(label: string, look: () => Promise<A>, done: (value: A) => boolean): Promise<A> => {
  const end = Date.now() + WAIT;
  let last: unknown = null;

  while (Date.now() < end) {
    try {
      const value = await look();
      last = value;

      if (done(value)) {
        return value;
      }
    } catch (error) {
      last = String(error);
    }

    await pause(250);
  }

  throw new Error(`${label}: no answer in ${WAIT} ms; last observed ${JSON.stringify(last)}`);
};

/** One door socket as the founder, past its signed hello: `call` is one JSON-RPC call and its frame. */
const door = async (instance: Instance, key: Key, tab: string) => {
  const socket = new WebSocket(
    `${String(instance.url).replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`,
  );
  const frames: Array<any> = [];
  let serial = 0;
  socket.addEventListener("message", (event) => {
    if (event.data !== "pong") {
      frames.push(Schema.decodeUnknownSync(Json)(String(event.data)));
    }
  });
  const next = async (match: (frame: any) => boolean) => {
    const found = await until(
      "a frame",
      async () => frames.findIndex(match),
      (i) => i >= 0,
    );
    return frames.splice(found, 1)[0];
  };
  const call = async (method: string, params: unknown) => {
    const id = ++serial;
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return next((frame) => frame.id === id);
  };
  const nonce = (await next((frame) => frame.method === "challenge")).params.nonce;
  const hello = await call("initialize", {
    versions: [1],
    has: [],
    ping: "30s",
    key: key.raw,
    tab,
    nonce,
    platform: "headless",
    os: "linux",
    sentAt: SENT,
    signed: key.proof(`fabrika-hello\n${instance.url}\n${tab}\n${nonce}`),
  });
  expect(hello.error, "the founder's hello is admitted").toBeUndefined();
  return { call, close: () => socket.close() };
};

/** Sets one env value for the scope and puts the old one back. */
const env = (name: string, value: string) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const old = process.env[name];
      process.env[name] = value;
      return old;
    }),
    (old) =>
      Effect.sync(() => {
        if (old === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = old;
        }
      }),
  );

/** One real local instance of the app's own build, with one founder whose window key is granted. */
const startInstance = Effect.fnUntraced(
  function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* env("DO_NOT_TRACK", "1");
    // A short home: a socket path has a 103-byte limit.
    const home = yield* fs.makeTempDirectoryScoped({ prefix: "ds2a-" });
    yield* env("FABRIKA_HOME", home);
    yield* fs.symlink(path.resolve(import.meta.dirname, "../node_modules"), path.join(home, "node_modules"));
    const built = yield* build({ out: path.join(home, "dist") });
    const port = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
    const key = identity();
    const instance: Instance = yield* localInstance(
      built,
      RecordWireTest.startupFixture({
        home,
        name: PROJECT,
        person: PERSON,
        founder: key.line,
        window: key.raw,
        port: port.port,
      }),
    );
    return { instance, key };
  },
  Effect.provide(SecureRandom.layerWebCrypto),
  Effect.provide(NodeServices.layer),
);

const calls = (instance: Instance) => {
  const project = () => instance.project(PROJECT);
  return {
    info: async (): Promise<Array<any>> => project().info(),
    facts: async (stream: string): Promise<Array<any>> =>
      ((await project().read(stream, 0, "audit")) as Array<any>).map((row) => ({ ...row.body, _tag: row._tag })),
  };
};

/** tezgah's process: the one live process whose name leads with `tezgah:`. */
const findTezgah = async (instance: Instance) => {
  const rows = await until(
    "tezgah's process in the table",
    () => calls(instance).info(),
    (all) => all.some((row) => String(row.name).startsWith("tezgah:")),
  );
  const found = rows.filter((row) => String(row.name).startsWith("tezgah:"));
  expect(found, "one tezgah process, for the one person").toHaveLength(1);
  return { pid: String(found[0].process), name: String(found[0].name) };
};

// L8's real half: the suite's walk, on its own instance, through the founder's door letters.
const open: RunnerTest.Open = Effect.gen(function* () {
  const { instance, key } = yield* startInstance();
  const socket = yield* Effect.acquireRelease(
    Effect.promise(() => door(instance, key, "desk-s2a-l8")),
    (d) => Effect.sync(d.close),
  );
  const tezgah = yield* Effect.promise(() => findTezgah(instance));
  let letters = 0;
  return {
    send: (m: unknown) =>
      Effect.promise(async () => {
        const answer = await socket.call("process.send", {
          pid: tezgah.pid,
          letter: `desk-s2a-${++letters}`,
          m,
          sentAt: SENT,
          seen: 0,
        });
        return answer.result ?? { _tag: "error", reason: String(answer.error?.data?.reason ?? "none") };
      }),
    view: Effect.promise(async () => (await socket.call("view.open", { pid: tezgah.pid })).result?.view),
    process: (name: string) =>
      Effect.promise(async () => {
        const live = (await calls(instance).info()).some((row) => row.name === name);
        const exited = (await calls(instance).facts(`processes/${name}`))
          .filter((row) => row._tag === "exited")
          .map((row) => row.reason);
        return { live, exited };
      }),
  };
}).pipe(Effect.orDie);

RunnerTest.suite(open);

/** What L12 reads of tezgah's view: workspace 1's tiles in reading order. */
const order = (node: any): ReadonlyArray<string> =>
  typeof node === "string" ? [node] : (node?.parts ?? []).flatMap((p: any) => order(p.inner));

const shown = (view: any) => {
  const space = (view?.workspaces ?? []).find((w: any) => w.n === 1);
  const ids = space === undefined ? [] : order(space.layout);
  return ids.map((id) => ({ id, name: (view.tiles ?? []).find((t: any) => t.id === id)?.shows }));
};

describe("Desk S2a L12: a headless window follows tezgah on the real instance", () => {
  it("scenario: L12: a headless client admitted as the founder reads tezgah, attaches, and sees each layout as the founder splits twice and closes once", async () => {
    // scenario: the plan's L12, one founder on the real dev brain; the generated walks are L5 to L11.
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { instance, key } = yield* startInstance();
          const signer: Identity = {
            fingerprint: key.fingerprint,
            raw: key.raw,
            line: Schema.decodeUnknownSync(KeyLine)(key.line),
            found: "reused",
            sign: (bytes) => Effect.sync(() => key.sign(bytes)),
          };
          const window = windowMachineFor({
            decode: () => Schema.decodeUnknownSync(checklistView),
            tile: () => undefined,
          });
          const booting = yield* Headless.start({
            tiles: [],
            desk: { workspace: 1 },
            window,
            origin: String(instance.url),
            build: "desk-s2a",
          }).pipe(
            Effect.provide(
              Layer.mergeAll(
                Layer.succeed(ClientKey, {
                  current: () => Effect.succeed(signer),
                  claimPersist: Effect.succeed(false),
                  persist: Effect.succeed(true),
                }),
                Layer.succeed(ClientRows, { put: () => Effect.void }),
                Id.Generator.layer,
              ),
            ),
          );
          const run = yield* booting.ready;
          const socket = yield* Effect.acquireRelease(
            Effect.promise(() => door(instance, key, "desk-s2a-l12")),
            (d) => Effect.sync(d.close),
          );

          yield* Effect.promise(async () => {
            const tezgah = await findTezgah(instance);
            const view = async () => (await socket.call("view.open", { pid: tezgah.pid })).result?.view;
            const tiles = () =>
              run
                .getState()
                .tiles.map((t) => ({ id: t.id, name: t.name, open: t.reach._tag === "open" }))
                .sort((a, b) => (a.id < b.id ? -1 : 1));
            /** The window shows exactly workspace 1's tiles in tezgah's view, each one open. */
            const follows = async (label: string, count: number) => {
              const want = await until(label, view, (v) => shown(v).length === count);
              const expected = shown(want)
                .map((t) => ({ ...t, open: true }))
                .sort((a, b) => (a.id < b.id ? -1 : 1));
              await until(
                `${label}: the window follows`,
                async () => tiles(),
                (got) => JSON.stringify(got) === JSON.stringify(expected),
              );
              expect(tiles(), `L12: ${label}`).toEqual(expected);
              return shown(want);
            };
            let letters = 0;
            const did = async (m: object) => {
              const sent = await socket.call("process.send", {
                pid: tezgah.pid,
                letter: `desk-s2a-l12-${++letters}`,
                m: { type: "did", via: { _tag: "key", keys: "ctrl+b %" }, ...m },
                sentAt: SENT,
                seen: 0,
              });
              expect(sent.result, `L12: tezgah takes ${JSON.stringify(m)}`).toMatchObject({ _tag: "accepted" });
            };

            await until(
              "the window is online",
              async () => run.getState().link._tag,
              (link) => link === "online",
            );
            const one = await follows("the window's own attach makes workspace 1 of checklist:1", 1);
            expect(
              one.map((t) => t.name),
              "L12: workspace 1's first tile is the boot list's checklist:1",
            ).toEqual(["checklist:1"]);

            const t2 = typeId("tile", 2);
            await did({ does: "tezgah.split_right", from: one[0]!.id, tile: t2 });
            const two = await follows("after a split right", 2);
            expect(
              two.map((t) => t.id),
              "L12: the new tile follows t1",
            ).toEqual([one[0]!.id, t2]);

            const t3 = typeId("tile", 3);
            await did({ does: "tezgah.split_down", from: t2, tile: t3 });
            const three = await follows("after a split down", 3);
            expect(
              three.map((t) => t.id),
              "L12: t3 follows t2",
            ).toEqual([one[0]!.id, t2, t3]);

            await did({ does: "tezgah.close", from: t2 });
            const closed = await follows("after a close", 2);
            expect(
              closed.map((t) => t.id),
              "L12: t2 is gone",
            ).toEqual([one[0]!.id, t3]);
            const ended = await until(
              "the closed tile's process ends",
              () => calls(instance).facts(`processes/${three[1]!.name}`),
              (rows) => rows.some((row) => row._tag === "exited"),
            );
            expect(
              ended.filter((row) => row._tag === "exited").map((row) => row.reason),
              "L12: the closed tile's process ends with shutdown",
            ).toMatchObject([{ _tag: "shutdown" }]);
          });
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
    );
  }, 900_000);
});
