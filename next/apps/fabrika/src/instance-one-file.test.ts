// P16, next/. P12's actual workerLoader, stack and localInstance contracts, not saved proof JSON.
// The door mints each stamped input ID with main's shared Id schema; this file never makes one.
// Builder contract: the app's `build(options)` (src/build.ts) needs FileSystem and Path and
// returns `{build, brain, programs, assets}`; the stack runs `built.brain` with `bundle: false`.
import assert from "node:assert/strict";
import childProcess, { spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer as httpServer } from "node:http";
import { syncBuiltinESMExports } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Id } from "@kampus/libfabrika";
import { workerLoader } from "@kampus/libfabrika/workers";
import { settings as readSettings } from "@kampus/libfabrika/workers/runtime";
import { Effect, Layer, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import * as fc from "fast-check";
import { parseSync } from "oxc-parser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { heldPort } from "./port.test-support.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";

const APP = resolve(import.meta.dirname, "..");
const homes: string[] = [];
const runs = { seed: 119120, numRuns: 3 };
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
// The platform's loader and stub types come from the code under test, never by their ambient
// names (0042, tests included).
type Platform = Parameters<typeof workerLoader>[0];

const home = () => {
  const h = mkdtempSync("/tmp/fh.");
  homes.push(h);
  vi.stubEnv("FABRIKA_HOME", h);
  vi.stubEnv("TYPESAFE_API_KEY", undefined);
  vi.stubEnv("DO_NOT_TRACK", "1");
  return h;
};

// Alchemy sends SIGKILL when its scope closes, but the child can still hold its port.
// Await the real close events before reusing that same port and saved state. No fixed sleep.
// The fixed brain port itself is Alchemy's in-process worker proxy, not workerd. Its 30-second
// port reservation outlived the proxy until the local patch made a closed proxy drop it.
const afterChildrenStop = async <A>(task: () => Promise<A>): Promise<A> => {
  const spawn = childProcess.spawn,
    closed: Promise<void>[] = [];
  const spy = vi.spyOn(childProcess, "spawn").mockImplementation((...args) => {
    const child = spawn(...args);
    closed.push(new Promise<void>((done) => child.once("close", () => done())));
    return child;
  });
  syncBuiltinESMExports();

  try {
    return await task();
  } finally {
    spy.mockRestore();
    syncBuiltinESMExports();
    await Promise.all(closed);
  }
};

// Runs `use` on a brain port held for the whole call, so nobody else is given it between two instances
// on it. The scope gives the port back only after `use`, and every instance it opened, has closed.
const onHeldPort = <A>(use: (port: number) => Promise<A>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const held = yield* Effect.acquireRelease(heldPort(), (p) => p.release);
        // A failed assertion in `use` is a defect: the run rejects with it and the test goes red.
        return yield* Effect.promise(() => use(held.port));
      }),
    ),
  );

// Change the disposable completed file, then exercise that file on the real instance below.
// Parsing finds P12's loader policy, so the plant cannot silently miss a formatting change.
const plantPolicy = (source: string, mode: "binding" | "outbound", name: string, value: string) => {
  const ranges: Array<{ start: number; end: number }> = [];
  const visit = (node: any): void => {
    if (node === null || typeof node !== "object") {
      return;
    }

    if (node.type === "ObjectExpression") {
      const prop = (key: string) => node.properties.find((p: any) => p.key?.name === key || p.key?.value === key);

      if (prop("mainModule")?.value?.value === "program.js" && prop("env") && prop("globalOutbound")) {
        const target = mode === "binding" ? prop("env").value : prop("globalOutbound");
        ranges.push({ start: target.start, end: target.end });
      }
    }

    for (const child of Object.values(node)) {
      visit(child);
    }
  };
  visit(parseSync("brain.mjs", source).program);
  assert.equal(ranges.length, 1, "plant must reach exactly one real loader policy");
  const at = ranges[0]!;
  // An empty spread removes the policy without leaving a spare comma before the tail options.
  const changed =
    source.slice(0, at.start) +
    (mode === "binding" ? JSON.stringify({ [name]: value }) : "...{}") +
    source.slice(at.end);
  assert.equal(parseSync("brain.mjs", changed).errors.length, 0, "plant must leave executable JavaScript");
  return changed;
};

// A loaded program answers its init and step calls with P11's Step. Decode it, never read it raw.
type Loaded = Readonly<Record<string, (...args: ReadonlyArray<unknown>) => Promise<unknown>>>;

const SealedTurn = Schema.Struct({
  _tag: Schema.Literal("stepped"),
  model: Schema.Struct({ keys: Schema.Array(Schema.String), outbound: Schema.String }),
});

const CounterTurn = Schema.Struct({
  _tag: Schema.Literal("stepped"),
  model: Schema.Struct({ count: Schema.Number }),
});

const turn = async <A>(
  schema: Schema.Codec<A, unknown>,
  program: Loaded,
  method: "init" | "step",
  args: ReadonlyArray<unknown>,
): Promise<A> => {
  const call = program[method];
  assert(call, `loaded program has no ${method}`);
  return Effect.runPromise(Schema.decodeUnknownEffect(schema)(await call(...args)));
};

afterEach(() => {
  vi.doUnmock("alchemy");
  vi.doUnmock("@alchemy.run/cloudflare");
  vi.resetModules();
  vi.unstubAllEnvs();

  for (const h of homes.splice(0)) {
    rmSync(h, { recursive: true, force: true });
  }
});

const field = (value: string | Buffer) => {
  const b = Buffer.from(value),
    n = Buffer.alloc(4);
  n.writeUInt32BE(b.length);
  return Buffer.concat([n, b]);
};

// P12's driver field names. Experiment 238's driver on branch fabrikalfa/exp241-script gives
// lostLinkMs and writes the caps: experiment 241's guess from its sitting's four base runs.
const Metrics = Schema.Struct({
  acceptedSend: Schema.Number,
  publication: Schema.Number,
  restart: Schema.Number,
  reconnect: Schema.Number,
  lostLink: Schema.Number,
  rss: Schema.Number,
  startup: Schema.Number,
});

const Sample = Schema.Struct({
  session: Schema.String,
  settings: Schema.String,
  chaos: Schema.Boolean,
  brain: Schema.String,
  load: Schema.String,
  missing: Schema.Record(Schema.String, Schema.String),
  error: Schema.optionalKey(Schema.String),
  startMs: Schema.Number,
  sendMs: Schema.Array(Schema.Number),
  publishMs: Schema.Array(Schema.Number),
  replaceMs: Schema.Number,
  reconnectMs: Schema.Number,
  lostLinkMs: Schema.Number,
  workerdRssMb: Schema.Number,
});

const Bar = Schema.Struct({
  driver: Schema.String,
  capsFrom: Schema.String,
  caps: Metrics,
  base: Schema.Array(Sample),
  head: Schema.Array(Sample),
  sizes: Schema.Struct({ brain: Schema.Number, programs: Schema.Number, window: Schema.Number }),
});
type Bar = typeof Bar.Type;

const median = (values: readonly number[]) => {
  assert(values.length > 0, "reading missing");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

const readings = (s: typeof Sample.Type) => ({
  acceptedSend: median(s.sendMs.slice(1)),
  publication: median(s.publishMs),
  restart: s.replaceMs,
  reconnect: s.reconnectMs,
  lostLink: s.lostLinkMs,
  rss: s.workerdRssMb,
  startup: s.startMs,
});

// Whether any selected program's package exports "./window", read from the same package.json
// files libfabrika's build reads: node_modules/<package> from `from` upward. A path has none.
const findManifest = (from: string, name: string): string | undefined => {
  const file = join(from, "node_modules", name, "package.json");

  if (existsSync(file)) {
    return file;
  }

  return dirname(from) === from ? undefined : findManifest(dirname(from), name);
};

const exportsWindow = (from: string, selected: ReadonlyArray<{ readonly package: string }>) =>
  selected.some(({ package: name }) => {
    const file = name.startsWith(".") || isAbsolute(name) ? undefined : findManifest(from, name);

    if (file === undefined) {
      return false;
    }

    const exports: unknown = JSON.parse(readFileSync(file, "utf8")).exports;
    return typeof exports === "object" && exports !== null && Object.hasOwn(exports, "./window");
  });

const localBar = (bar: Bar, digest: string, enforce: boolean, windowed: boolean) => {
  // oxlint-disable-next-line fabrika/no-stage-word -- saved speed-bar results name experiment 238's driver exactly
  assert.equal(bar.driver, "experiments/238-local-stage-speed-bar.ts");
  assert.match(bar.capsFrom, /experiments?[/ ]241(?!\d)/, "capsFrom must name experiment 241");
  assert.equal(bar.base.length, 4);
  assert.equal(bar.head.length, 5);

  for (const sample of [...bar.base, ...bar.head]) {
    assert.equal(sample.error, undefined, "failed run");
    assert.deepEqual(sample.missing, {}, "missing reading");

    for (const key of ["session", "settings", "chaos"] as const) {
      assert.equal(sample[key], bar.base[0]![key], "different sitting or settings");
    }

    assert(sample.load.length > 0, "load missing");

    for (const value of Object.values(readings(sample))) {
      assert(Number.isFinite(value) && value >= 0, "invalid reading");
    }
  }

  for (const sample of bar.head) {
    assert.equal(sample.brain, digest, "wrong built bytes");
  }

  for (const key of ["brain", "programs"] as const) {
    assert(Number.isFinite(bar.sizes[key]) && bar.sizes[key] > 0, `${key} bytes missing`);
  }

  assert(Number.isFinite(bar.sizes.window) && bar.sizes.window >= 0, "window bytes invalid");

  if (windowed) {
    assert(bar.sizes.window > 0, "window bytes missing for a program with a window");
  }

  for (const key of Object.keys(bar.caps) as Array<keyof typeof bar.caps>) {
    assert(Number.isFinite(bar.caps[key]) && bar.caps[key] > 0, "recorded cap missing");

    if (enforce) {
      assert(median(bar.head.map((s) => readings(s)[key])) <= bar.caps[key], `local bar regressed: ${key}`);
    }
  }
};

const identity = () => {
  const pair = generateKeyPairSync("ed25519"),
    raw = pair.publicKey.export({ format: "jwk" }).x!;
  const blob = Buffer.concat([field("ssh-ed25519"), field(Buffer.from(raw, "base64url"))]);
  return {
    raw,
    line: `ssh-ed25519 ${blob.toString("base64")}`,
    fingerprint: `SHA256:${createHash("sha256").update(Buffer.from(raw, "base64url")).digest("base64").replace(/=+$/, "")}`,
    proof: (text: string) => {
      const payload = Buffer.concat([
        Buffer.from("SSHSIG"),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(createHash("sha512").update(text).digest()),
      ]);
      const version = Buffer.alloc(4);
      version.writeUInt32BE(1);
      return `-----BEGIN SSH SIGNATURE-----\n${Buffer.concat([
        Buffer.from("SSHSIG"),
        version,
        field(blob),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(Buffer.concat([field("ssh-ed25519"), field(sign(null, payload, pair.privateKey))])),
      ])
        .toString("base64")
        .match(/.{1,70}/g)!
        .join("\n")}\n-----END SSH SIGNATURE-----\n`;
    },
  };
};

describe("P16 stack and sealed loader", () => {
  it("p33 environment and declarations: actual stack selects completed bytes, no rebundle, byte-limited code-free env", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1600, max: 1800 }), fc.boolean(), async (length, multibyte) => {
        const calls: Array<{ main: string; bundle: boolean; env: Record<string, unknown> }> = [];
        vi.doMock("@alchemy.run/cloudflare", () => ({
          providers: () => Layer.empty,
          R2: { Bucket: () => Effect.succeed({ type: "r2" }) },
          DurableObject: (name: string) => ({ type: "object", name }),
          WorkerLoader: () => ({ type: "loader" }),
          Workers: {
            Worker: (_name: string, props: (typeof calls)[number]) => {
              calls.push(props);
              return Effect.succeed({ url: "http://test.invalid" });
            },
          },
        }));
        vi.doMock("alchemy", () => ({
          localState: () => Layer.empty,
          Stack: (_name: string, _options: unknown, body: Effect.Effect<unknown>) => body,
        }));
        vi.resetModules();
        const { stack } = await import("../alchemy.run.ts"),
          h = home();
        const built = {
          brain: join(h, "brain.mjs"),
          build: hash("brain"),
          programs: { counter: { hash: hash("program-marker"), source: "program-marker" } },
        };
        let accepted = 0;

        for (const name of ["local", "cloud"]) {
          const settings = RecordWireTest.settingsFixture({
            name,
            port: 18787,
            person: "person-test",
            founder: (multibyte ? "雪" : "a").repeat(length),
            window: null,
            build: built.build,
          });
          const checked = await Effect.runPromise(readSettings({ INSTANCE: JSON.stringify(settings) }));
          const result = await Effect.runPromise(Effect.result(stack(built, checked)));
          const expectedBytes = Buffer.byteLength(JSON.stringify(settings));

          if (expectedBytes >= 5 * 1024) {
            expect(result._tag, "oversized serialized setting must be refused").toBe("Failure");
            continue;
          }

          expect(result._tag).toBe("Success");
          accepted++;
        }

        const verify = (call: (typeof calls)[number]) => {
          expect(call.main, "the instance runs the completed file").toBe(built.brain);
          expect(call.bundle, "no second bundle pass").toBe(false);

          for (const [name, value] of Object.entries(call.env)) {
            expect(name).not.toMatch(/WINDOW_JS|PROGRAM_SOURCE/);
            expect(JSON.stringify(value)).not.toContain("program-marker");

            if (typeof value === "string") {
              expect(Buffer.byteLength(value), "setting under 5 KB encoded").toBeLessThan(5 * 1024);
            } else {
              expect(value).toHaveProperty("type");
            }
          }
        };

        for (const call of calls) {
          verify(call);
        }

        // Plants on a real declaration: code back in env, a source entry, a rebundle, and a
        // multibyte setting that passes a character count.
        const real = calls[0];

        if (real) {
          for (const plant of [
            { ...real, env: { ...real.env, WINDOW_JS: "export const x = 1;" } },
            { ...real, env: { ...real.env, CODE: "program-marker" } },
            { ...real, env: { ...real.env, WIDE: "雪".repeat(1800) } },
            { ...real, main: join(APP, "src/brain.ts") },
            { ...real, bundle: true },
          ]) {
            expect("雪".repeat(1800).length).toBeLessThan(5 * 1024);
            expect(() => verify(plant)).toThrow();
          }
        }

        expect(calls.length, "each accepted instance declared one Worker").toBe(accepted);
        vi.doUnmock("alchemy");
        vi.doUnmock("@alchemy.run/cloudflare");
        vi.resetModules();
      }),
      { ...runs, numRuns: 6 },
    );
  });
  it("p33 loader: actual config uses recorded bytes/hash and exact process, empty env, null outbound; unknown is typed no_program", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        fc.uuid(),
        fc.string({ minLength: 1, maxLength: 20 }),
        async (source, process, missing) => {
          const calls: Array<{ key: string | null; config: unknown }> = [];
          const unused = () => {
            throw Error("unused Worker Loader capability");
          };
          const rpc = {
            describe: async () => ({ name: "fabrika/counter", v: 1, writes: {}, inputs: {}, cmds: [] }),
            fetch: unused,
            connect: unused,
          };
          const stub: ReturnType<Platform["get"]> = {
            getEntrypoint: unused,
            getDurableObjectClass: unused,
          };
          vi.spyOn(stub, "getEntrypoint").mockReturnValue(rpc);
          // Record the real adapter's config; the copied-file tests below exercise workerd itself.
          const platform: Platform = {
            get: (key, callback) => {
              calls.push({ key, config: callback() });
              return stub;
            },
            load: unused,
          };
          // P40, L4: lookups use the whole qualified name. Another pack's `counter` sits beside it
          // with other code, and the bare short name finds neither.
          const other = `${source}-other-pack`;
          const loader = workerLoader(platform, {
            "fabrika/counter": { hash: hash(source), source },
            "other/counter": { hash: hash(other), source: other },
          });
          const bare = await Effect.runPromise(Effect.result(loader.load("counter", process)));
          expect(bare).toMatchObject({ _tag: "Failure", failure: { _tag: "ProgramDown", reason: "no_program" } });
          const loaded = await Effect.runPromise(loader.load("fabrika/counter", process));
          expect(loaded.hash).toBe(hash(source));
          expect(calls).toEqual([
            {
              key: `${hash(source)}/${process}`,
              config: {
                compatibilityDate: "2026-10-12",
                mainModule: "program.js",
                modules: { "program.js": source },
                env: {},
                globalOutbound: null,
              },
            },
          ]);
          const refused = await Effect.runPromise(Effect.result(loader.load(`missing-${missing}`, process)));
          expect(refused).toMatchObject({
            _tag: "Failure",
            failure: { _tag: "ProgramDown", reason: "no_program" },
          });
          expect(calls).toHaveLength(1);
          const config = calls[0]!.config;
          const sealed = (value: unknown) => assert.deepEqual(value, config);

          for (const plant of [
            { ...Object(config), env: { PLANTED: source } },
            { ...Object(config), globalOutbound: undefined },
            { ...Object(config), modules: { "program.js": "host fallback" } },
          ]) {
            expect(() => sealed(plant)).toThrow();
          }
        },
      ),
      { ...runs, numRuns: 12 },
    );
  });
});

// P12's driver protocol, exercised on copied output. No private key is read from disk.
class Client {
  readonly frames: any[] = [];
  readonly ws: WebSocket;
  readonly url: string;
  readonly key: ReturnType<typeof identity>;
  readonly tab: string;
  serial = 0;

  constructor(url: string, key: ReturnType<typeof identity>, tab: string) {
    this.url = url;
    this.key = key;
    this.tab = tab;
    this.ws = new WebSocket(`${url.replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`);
    this.ws.addEventListener("error", () => this.frames.push({ closed: true }));
    this.ws.addEventListener("close", () => this.frames.push({ closed: true }));
    this.ws.addEventListener("message", ({ data }) => this.frames.push(JSON.parse(String(data))));
  }

  async next(match: (x: any) => boolean): Promise<any> {
    for (;;) {
      const at = this.frames.findIndex(match);

      if (at >= 0) {
        return this.frames.splice(at, 1)[0];
      }

      if (this.frames.some((x) => x.closed)) {
        throw Error("wire closed");
      }

      await new Promise((done) => setTimeout(done, 10));
    }
  }

  async call(method: string, params: unknown) {
    const id = ++this.serial;
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return this.next((x) => x.id === id);
  }

  async hello() {
    const {
      params: { nonce },
    } = await this.next((x) => x.method === "challenge");
    return this.call("initialize", {
      versions: [1],
      has: ["seal"],
      ping: "30s",
      key: this.key.raw,
      tab: this.tab,
      nonce,
      platform: "headless",
      os: "linux",
      sentAt: "2026-11-08T04:00:00.000Z",
      signed: this.key.proof(`fabrika-hello\n${this.url}\n${this.tab}\n${nonce}`),
    });
  }
}

describe("P16 copied-file real instance, serial", () => {
  it("shutdown: a stopped child closes before the next instance, including when the prior instance fails", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.integer(), async (fail, value) => {
        let closed = false;
        const task = afterChildrenStop(async () => {
          const child = spawn(process.execPath, ["-e", ""]);
          child.once("close", () => {
            closed = true;
          });
          await new Promise<void>((done, reject) => {
            child.once("spawn", done);
            child.once("error", reject);
          });
          child.kill("SIGKILL");

          if (fail) {
            throw new Error(`planted instance failure ${value}`);
          }

          return value;
        });

        if (fail) {
          await expect(task).rejects.toThrow(`planted instance failure ${value}`);
        } else {
          expect(await task).toBe(value);
        }

        expect(closed, "next instance must wait for the real child close event").toBe(true);
      }),
      { ...runs, numRuns: 8 },
    );
  });
  it("isolation plants reach the actual compiled loader policy before a real-instance run", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 9999 }), async (n) => {
        const h = home(),
          { build } = await import("./build.ts");
        const built = await Effect.runPromise(
          build({ out: join(h, "dist"), files: [], ledger: [] }).pipe(Effect.provide(NodeServices.layer)),
        );
        const source = readFileSync(built.brain, "utf8");

        for (const mode of ["binding", "outbound"] as const) {
          expect(plantPolicy(source, mode, `P16_${n}`, String(n))).not.toBe(source);
        }
      }),
      { ...runs, numRuns: 2 },
    );
  });
  it("p33 real isolation: a selected program sees no planted binding and cannot reach a controlled HTTP target", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 9999 }), async (n) => {
        const h = home(),
          key = identity();
        let hits = 0;
        const probe = httpServer((_request, response) => {
          hits++;
          response.end("reachable");
        });

        try {
          const port = await new Promise<number>((done, fail) => {
            probe.once("error", fail);
            probe.listen(0, "127.0.0.1", () => {
              const at = probe.address();
              assert(at && typeof at !== "string");
              done(at.port);
            });
          });
          const target = `http://127.0.0.1:${port}/probe-${n}`;
          expect((await fetch(target)).ok).toBe(true);
          hits = 0;
          symlinkSync(join(APP, "node_modules"), join(h, "node_modules"));
          const file = join(h, "sealed.ts");
          writeFileSync(
            file,
            // workerd refuses I/O at module scope whatever the policy, so a top-level fetch proves nothing.
            // The program fetches inside the init call and keeps it alive with waitUntil, as a hostile
            // program would; only the loader's own refusal counts as denied.
            `import {env, waitUntil} from 'cloudflare:workers'; import {Machine} from '@demlik/tea/effect'; import {Schema} from 'effect'; let outbound='pending'; const probe=()=>{try {waitUntil(fetch(${JSON.stringify(target)}).then(()=>{outbound='allowed'},(e)=>{outbound=String(e).includes('not permitted to access the internet')?'denied':'failed'}))} catch (e) {outbound=String(e).includes('not permitted to access the internet')?'denied':'failed'}}; const Model=Schema.Struct({keys:Schema.Array(Schema.String),outbound:Schema.String}); const Msg=Schema.Struct({type:Schema.Literal('read')}); const machine=Machine.make({model:Model,msg:Msg,init:()=>{probe(); return [{keys:Object.keys(env),outbound},[]]},update:{read:s=>[{...s,outbound},[]]}}); export const program={name:'sealed',machine,state:{v:1,schema:Model,upgrades:[]},msg:Msg,view:{data:Model,select:s=>s},refuse:()=>null,inputs:{},outputs:{},writes:{},wake:()=>null};`,
          );
          const { build } = await import("./build.ts"),
            { localInstance } = await import("./local-instance.ts"),
            { localState } = await import("alchemy/State/LocalState");
          const built = await Effect.runPromise(
            build({
              out: join(h, "dist"),
              files: [],
              ledger: [],
              programs: Object.fromEntries(Array.from({ length: (n % 3) + 1 }, (_, i) => [`p33/sealed-${i}`, file])),
            }).pipe(Effect.provide(NodeServices.layer)),
          );
          const alone = join(h, "alone");
          mkdirSync(alone);
          cpSync(built.brain, join(alone, "brain.mjs"));
          const bytes = readFileSync(join(alone, "brain.mjs"), "utf8");
          rmSync(join(h, "dist"), { recursive: true });
          rmSync(file);

          // The three modes start one instance each on one brain port, held across all three.
          await onHeldPort(async (brainPort) => {
            for (const mode of ["sealed", "binding", "outbound"] as const) {
              writeFileSync(
                join(alone, "brain.mjs"),
                mode === "sealed" ? bytes : plantPolicy(bytes, mode, `P16_${n}`, String(n)),
              );
              hits = 0;
              await afterChildrenStop(() =>
                Effect.runPromise(
                  Effect.scoped(
                    Effect.gen(function* () {
                      const instance = yield* localInstance(
                        { ...built, brain: join(alone, "brain.mjs") },
                        RecordWireTest.startupFixture({
                          home: h,
                          name: "p16-isolation",
                          person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
                          founder: key.line,
                          window: key.raw,
                          port: brainPort,
                        }),
                      );
                      yield* Effect.tryPromise({
                        try: async () => {
                          expect(Object.keys(built.programs).length).toBeGreaterThan(0);

                          for (const name of Object.keys(built.programs)) {
                            const program: Loaded = await instance.loader.load(name, `probe-${n}-${mode}-${name}`);

                            if (name === "fabrika/counter") {
                              const counted = await turn(CounterTurn, program, "init", [null]);
                              expect(counted.model).toEqual({ count: 0 });
                              continue;
                            }

                            let model = (await turn(SealedTurn, program, "init", [null])).model;

                            // Read until the program's own fetch settles. The test time limit bounds the wait.
                            while (model.outbound === "pending") {
                              await new Promise((done) => setTimeout(done, 10));
                              model = (await turn(SealedTurn, program, "step", [model, { type: "read" }])).model;
                            }

                            const closed = (model: unknown) =>
                              assert.deepEqual(model, { keys: [], outbound: "denied" });

                            if (mode === "sealed") {
                              closed(model);
                              expect(hits).toBe(0);
                            } else {
                              if (mode === "outbound") {
                                expect(hits).toBeGreaterThan(0);
                              }

                              expect(() => closed(model)).toThrow();
                              expect(model).toEqual(
                                mode === "binding"
                                  ? { keys: [`P16_${n}`], outbound: "denied" }
                                  : { keys: [], outbound: "allowed" },
                              );
                            }
                          }
                        },
                        catch: (error) => new Error("P16 isolation check failed", { cause: error }),
                      });
                    }),
                  ).pipe(
                    Effect.provide(localState()),
                    Effect.provide(SecureRandom.layerWebCrypto),
                    Effect.provide(NodeServices.layer),
                  ),
                ),
              );
            }
          });
        } finally {
          if (probe.listening) {
            await new Promise<void>((done) => probe.close(() => done()));
          }
        }
      }),
      { ...runs, numRuns: 2 },
    );
  });
  it("p33 complete output and T10 recovery: copied file loads programs; resend after restart retains placing, stamped ID, inbox and both views", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom("inc", "dec", "reset"), { minLength: 1, maxLength: 4 }),
        async (messages) => {
          const h = home(),
            key = identity();
          const { build } = await import("./build.ts"),
            { localInstance } = await import("./local-instance.ts");
          const built = await Effect.runPromise(
            build({ out: join(h, "dist"), files: [], ledger: [] }).pipe(Effect.provide(NodeServices.layer)),
          );
          const alone = join(h, "alone");
          mkdirSync(alone);
          cpSync(built.brain, join(alone, "brain.mjs"));
          rmSync(join(h, "dist"), { recursive: true });
          const options = (port: number) => ({
            home: h,
            name: "p16-instance",
            person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
            founder: key.line,
            window: key.raw,
            port,
          });
          const copied = { ...built, brain: join(alone, "brain.mjs") };
          let pid = "",
            first: unknown,
            stamped = "",
            total = 0;
          const instance = async (port: number, again: boolean) =>
            afterChildrenStop(async () =>
              Effect.runPromise(
                Effect.scoped(
                  Effect.gen(function* () {
                    const runtime = yield* localInstance(copied, RecordWireTest.startupFixture(options(port)));
                    yield* Effect.tryPromise({
                      try: async () => {
                        const a = new Client(runtime.url, key, "a"),
                          b = new Client(runtime.url, key, "b");

                        try {
                          expect((await a.hello()).error).toBeUndefined();
                          expect((await b.hello()).error).toBeUndefined();
                          const rows = (await a.call("ledger.read", { stream: "processes/counter:1", after: 0 })).result
                            .entries;
                          // P40, L4 and L7: the brain's process facts name the qualified code
                          // under the registered name, before and after the restart.
                          expect(rows.findLast((r: any) => r._tag === "started").body).toMatchObject({
                            name: "counter:1",
                            program: "fabrika/counter",
                          });
                          const current = rows.findLast((r: any) => r._tag === "started").body.process;

                          if (again) {
                            expect(current).toBe(pid);
                          } else {
                            pid = current;
                          }

                          await b.call("view.open", { pid });

                          for (const [n, type] of messages.entries()) {
                            const answer = await a.call("process.send", {
                              pid,
                              letter: `p16-${n}`,
                              m: { type },
                              sentAt: "2026-11-08T04:00:00.000Z",
                              seen: 0,
                            });
                            expect(answer.result).toMatchObject({ _tag: "accepted" });

                            if (n === 0) {
                              if (again) {
                                expect(answer.result).toEqual(first);
                              } else {
                                first = answer.result;
                              }
                            }

                            if (!again) {
                              total = type === "reset" ? 0 : total + (type === "inc" ? 1 : -1);
                            }
                          }

                          const inbox = (await a.call("ledger.read", { stream: "counter:1/inbox", after: 0 })).result
                            .entries;
                          const acknowledged = inbox.filter((r: any) => String(r.id).startsWith("p16-"));
                          expect(acknowledged).toHaveLength(messages.length);
                          expect(new Set(acknowledged.map((r: any) => r.id)).size).toBe(messages.length);
                          const input = inbox[0].parent;
                          // The door's minted ID passes main's shared schema; a letter ID does not.
                          const minted = Schema.is(Id.InputId);
                          expect(minted(input), 'stamped input uses Id.make("input")').toBe(true);
                          expect(minted(inbox[0].id), "the letter ID stays its own").toBe(false);

                          if (again) {
                            expect(input).toBe(stamped);
                          } else {
                            stamped = input;
                          }

                          if (again) {
                            const retried = await a.call("process.send", {
                              pid,
                              letter: "unanswered",
                              m: { type: "inc" },
                              sentAt: "2026-11-08T04:00:00.000Z",
                              seen: 0,
                            });
                            expect(retried.result).toMatchObject({ _tag: "accepted" });
                            const after = (await a.call("ledger.read", { stream: "counter:1/inbox", after: 0 })).result
                              .entries;
                            expect(after.filter((r: any) => r.id === "unanswered")).toHaveLength(1);

                            for (const c of [a, b]) {
                              expect((await c.call("view.open", { pid })).result.view).toEqual({
                                count: total + 1,
                              });
                            }
                          } else {
                            for (const c of [a, b]) {
                              expect((await c.call("view.open", { pid })).result.view).toEqual({
                                count: total,
                              });
                            }

                            a.ws.send(
                              JSON.stringify({
                                jsonrpc: "2.0",
                                id: 999999,
                                method: "process.send",
                                params: {
                                  pid,
                                  letter: "unanswered",
                                  m: { type: "inc" },
                                  sentAt: "2026-11-08T04:00:00.000Z",
                                  seen: 0,
                                },
                              }),
                            );
                            a.ws.close();
                          }

                          // Every embedded route must answer from this one file. P14 is absent on this base.
                          const missing = await fetch(`${runtime.url}/p16-missing.js`);
                          expect(missing.status).toBe(404);
                        } finally {
                          a.ws.close();
                          b.ws.close();
                        }
                      },
                      catch: (error) => new Error("P16 recovery check failed", { cause: error }),
                    });
                  }),
                ).pipe(
                  Effect.provide((await import("alchemy/State/LocalState")).localState()),
                  Effect.provide(SecureRandom.layerWebCrypto),
                  Effect.provide(NodeServices.layer),
                ),
              ),
            );
          // The restart comes back on the same port: held across both starts, never re-asked.
          await onHeldPort(async (port) => {
            await instance(port, false);
            await instance(port, true);
          });
        },
      ),
      { ...runs, numRuns: 2 },
    );
  });
  // scenario: a fixed base/head benchmark, because it measures real laptop performance.
  it("scenario: T10 timing checks experiment 241's four base and five head readings on the laptop; without a bar file it skips the cap check", async () => {
    const path = process.env.P16_LOCAL_BAR;

    if (!path) {
      console.log(
        "T10 cap check skipped: P16_LOCAL_BAR is unset, so there is no bar file; the bar blocks on the laptop only",
      );
      return;
    }

    const bar = Schema.decodeUnknownSync(Schema.fromJsonString(Bar))(readFileSync(path, "utf8"));
    const brain = process.env.P16_BRAIN;
    assert(brain, "final brain path missing");
    const digest = createHash("sha256").update(readFileSync(brain)).digest("hex");
    const { programs } = await import("./table.ts");
    const windowed = exportsWindow(join(APP, "src"), programs);
    localBar(bar, digest, !process.env.CI, windowed);
    console.log(
      JSON.stringify({
        law: "T10",
        base: bar.base.map(readings),
        head: bar.head.map(readings),
        sizes: bar.sizes,
      }),
    );
    expect(() =>
      localBar(
        {
          ...bar,
          head: bar.head.map((s) => ({
            ...s,
            sendMs: s.sendMs.map(() => bar.caps.acceptedSend + 1),
          })),
        },
        digest,
        true,
        windowed,
      ),
    ).toThrow("acceptedSend");
    expect(() =>
      localBar({ ...bar, head: bar.head.map((s) => ({ ...s, error: "planted failure" })) }, digest, false, windowed),
    ).toThrow("failed run");
    expect(() => localBar(bar, "wrong digest", false, windowed)).toThrow("wrong built bytes");
    expect(() => localBar({ ...bar, capsFrom: "ticket-115's rule (a guess)" }, digest, false, windowed)).toThrow(
      "experiment 241",
    );

    for (const key of ["brain", "programs"] as const) {
      expect(() => localBar({ ...bar, sizes: { ...bar.sizes, [key]: 0 } }, digest, false, windowed)).toThrow(
        `${key} bytes missing`,
      );
    }

    // A program whose package.json exports "./window", read the way the build reads it.
    const planted = home();
    mkdirSync(join(planted, "src"));
    mkdirSync(join(planted, "node_modules/@p16/windowed"), { recursive: true });
    writeFileSync(
      join(planted, "node_modules/@p16/windowed/package.json"),
      JSON.stringify({ exports: { ".": "./program.ts", "./window": "./window.tsx" } }),
    );
    const withWindow = [...programs, { name: "windowed", package: "@p16/windowed" }];
    expect(exportsWindow(join(planted, "src"), withWindow)).toBe(true);
    expect(() =>
      localBar(
        { ...bar, sizes: { ...bar.sizes, window: 0 } },
        digest,
        false,
        exportsWindow(join(planted, "src"), withWindow),
      ),
    ).toThrow("window bytes missing");
  });
});
