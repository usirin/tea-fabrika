// P15 slice 1, next/. Hot reload on the real instance: laws L16 and L17 of the approved plan. The
// instance is built, started and watched as dev.ts composes them, on a fixture copy of the counter
// (`reload.test-support.ts`); every press and read goes through P12's browser protocol driver.
//
// Test contract: the watcher's answers carry the brain's `Installed`: `loaded {processes: [{name,
// outcome}]}` with each process's `Swapped`, `same`, or `failed {reason}`; a bundle error reaches the
// brain as `code.failed {hash: null, reason: "bundle", path, line}`, its `path` relative to the
// watcher's root.
//
// These start workerd, a port, Chromium and a file watcher. They run through the exam's e2e runner
// (`node next/apps/fabrika/e2e.ts`), one file at a time, never in a sandbox that refuses them.
import { NodeServices } from "@effect/platform-node";
import { build } from "@kampus/libfabrika/build";
import { Effect, FileSystem, type Layer, Path, Schedule, Schema, type Scope, Stream } from "effect";
import { SecureRandom } from "effect/crypto";
import { Base64Url } from "effect/encoding";
import { ChildProcess } from "effect/process";
import * as fc from "fast-check";
import { chromium, type Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import {
  APP,
  cli,
  counterSource,
  fixture,
  fixtureBuild,
  instance,
  nextAnswer,
  PROGRAM,
  rebuildSpans,
  ROOT,
  spanOutputs,
} from "./reload.test-support.ts";

/** What the driver leaves on the page for later calls. */
declare global {
  interface Window {
    readonly p15: {
      readonly call: (method: string, params: unknown) => Promise<any>;
      readonly frames: Array<{ readonly method?: string }>;
    };
  }
}

/** A Playwright call rejected: the browser, its page or a script run in the page failed. */
class BrowserFailure extends Schema.TaggedError<BrowserFailure>()("BrowserFailure", { cause: Schema.Defect() }) {}

const browserCall = <A>(work: () => Promise<A>) =>
  Effect.tryPromise({ try: work, catch: (cause) => new BrowserFailure({ cause }) });

/** A browser with one page on the instance's own origin, given back with the scope. */
const page = (url: string) =>
  Effect.gen(function* () {
    const browser = yield* Effect.acquireRelease(
      browserCall(() => chromium.launch({ headless: true })),
      (b) => Effect.orDie(browserCall(() => b.close())),
    );
    const p = yield* browserCall(() => browser.newContext().then((c) => c.newPage()));
    yield* browserCall(() => p.goto(url));
    return p;
  });

/**
 * P12's browser protocol driver, as `instance.test.ts` runs it: a nonextractable Ed25519 key in real
 * IndexedDB, the signed hello, and JSON-RPC over the door's WebSocket. Answers `call`.
 */
const driver = (p: Page, url: string, tab: string) =>
  browserCall(() =>
    p.evaluate(
      async ({ url, tab }) => {
        const bytes = (s: string) => new TextEncoder().encode(s);
        const concat = (...parts: Array<Uint8Array>) => {
          const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
          let at = 0;

          for (const part of parts) {
            result.set(part, at);
            at += part.length;
          }

          return result;
        };
        const field = (data: string | Uint8Array) => {
          const body = typeof data === "string" ? bytes(data) : data,
            n = new Uint8Array(4);
          new DataView(n.buffer).setUint32(0, body.length);
          return concat(n, body);
        };
        const b64 = (data: Uint8Array) => btoa(String.fromCharCode(...data));
        const pair = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]);
        const publicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
        const raw = b64(publicBytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
        const fingerprint = `SHA256:${b64(new Uint8Array(await crypto.subtle.digest("SHA-256", publicBytes))).replace(/=+$/, "")}`;
        const proof = async (text: string) => {
          const blob = concat(field("ssh-ed25519"), field(publicBytes));
          const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", bytes(text)));
          const payload = concat(bytes("SSHSIG"), field("fabrika-client"), field(""), field("sha512"), field(digest));
          const signed = new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, payload));
          const version = new Uint8Array(4);
          new DataView(version.buffer).setUint32(0, 1);
          const packet = concat(
            bytes("SSHSIG"),
            version,
            field(blob),
            field("fabrika-client"),
            field(""),
            field("sha512"),
            field(concat(field("ssh-ed25519"), field(signed))),
          );
          return `-----BEGIN SSH SIGNATURE-----\n${b64(packet)
            .match(/.{1,70}/g)!
            .join("\n")}\n-----END SSH SIGNATURE-----\n`;
        };
        let serial = 0;
        const frames: Array<unknown> = [];
        let socket: WebSocket;
        const pending = new Map<number, (frame: unknown) => void>();
        const call = (method: string, params: unknown) =>
          new Promise<any>((done) => {
            const id = ++serial;
            pending.set(id, done);
            socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
          });
        const hello = async (nonce: string) =>
          call("initialize", {
            versions: [1],
            has: ["seal"],
            ping: "30s",
            key: raw,
            tab,
            nonce,
            platform: "browser",
            os: "linux",
            sentAt: "2026-11-11T04:00:00.000Z",
            signed: await proof(`fabrika-hello\n${url}\n${tab}\n${nonce}`),
          });
        const first = await new Promise<any>((done, fail) => {
          socket = new WebSocket(`${url.replace("http", "ws")}/client/${encodeURIComponent(fingerprint)}/${tab}`);
          socket.onerror = () => fail(new Error("WebSocket failed"));
          socket.onmessage = async ({ data }) => {
            if (data === "pong") {
              return;
            }

            // oxlint-disable-next-line eslint/no-restricted-properties -- this runs inside the browser page, where Effect Schema is not loaded
            const frame = JSON.parse(String(data));
            frames.push(frame);

            if (frame.method === "challenge") {
              done(await hello(frame.params.nonce));
            }

            if (frame.method === "client.granted") {
              frames.push({ method: "reinitialized", result: await hello(frame.params.nonce) });
            }

            if (typeof frame.id === "number") {
              pending.get(frame.id)?.(frame);
              pending.delete(frame.id);
            }
          };
        });
        Object.assign(globalThis, { p15: { call, frames } });
        return { first, fingerprint };
      },
      { url, tab },
    ),
  );

/** One JSON-RPC call through the page's driver. */
const rpc = (p: Page, method: string, params: unknown) =>
  browserCall(() => p.evaluate(async ({ method, params }) => window.p15.call(method, params), { method, params }));

/** The page's key, granted by the founder through grant.ts, as a person does it. */
const grant = (p: Page, url: string, fingerprint: string, key: string) =>
  Effect.gen(function* () {
    const knock = yield* rpc(p, "gateway.knock", { label: "Chromium" });
    const env = { ...process.env };
    delete env.TYPESAFE_API_KEY;
    // The instance listens on this thread too, so the grant command must leave it free to answer.
    const [printed, exitCode] = yield* Effect.scoped(
      Effect.gen(function* () {
        const command = yield* ChildProcess.make(
          process.execPath,
          [
            `${APP}/grant.ts`,
            "client",
            url,
            fingerprint,
            `--code=${knock.result.code}`,
            "--label=Chromium",
            `--key=${key}`,
          ],
          { cwd: APP, env, stdin: "ignore", stderr: "inherit" },
        );
        return yield* Effect.all([Stream.mkString(Stream.decodeText(command.stdout)), command.exitCode], {
          concurrency: 2,
        });
      }),
    );
    expect(Number(exitCode), `grant.ts client: ${printed}`).toBe(0);
    yield* browserCall(() => p.waitForFunction(() => window.p15.frames.some((f) => f.method === "reinitialized")));
  });

/** Runs one law's world: every resource it acquired is given back when it ends. */
const scoped = <A, E>(
  work: Effect.Effect<A, E, Scope.Scope | Layer.Success<typeof NodeServices.layer> | SecureRandom.SecureRandom>,
) =>
  Effect.runPromise(
    Effect.scoped(work).pipe(Effect.provide(NodeServices.layer), Effect.provide(SecureRandom.layerWebCrypto)),
  );

/** Every object in a JSON value, depth first, so an answer is read by its shape, never its text. */
const objects = (value: unknown): ReadonlyArray<Record<string, unknown>> =>
  typeof value !== "object" || value === null
    ? []
    : Array.isArray(value)
      ? value.flatMap(objects)
      : [value as Record<string, unknown>, ...Object.values(value).flatMap(objects)];

/** The outcome an answer gives for `counter:1`, or its failure's reason. */
const outcome = (answer: unknown) => {
  const loaded = objects(answer).find((o) => Array.isArray(o.processes));
  const row = (loaded?.processes as ReadonlyArray<{ name: string; outcome: { _tag: string; reason?: string } }>)?.find(
    (p) => p.name === "counter:1",
  );
  const failed = objects(answer).find((o) => o._tag === "failed");
  return row?.outcome ?? (failed === undefined ? { _tag: "same" } : { _tag: "failed", reason: failed.reason });
};

/** A session on the instance: a granted browser key, the counter's process and its reads. */
const session = (url: string, key: string) =>
  Effect.gen(function* () {
    const p = yield* page(url);
    const { fingerprint } = yield* driver(p, url, "tab-a");
    yield* grant(p, url, fingerprint, key);
    const processes = yield* rpc(p, "ledger.read", { stream: "processes/counter:1", after: 0 });
    const pid: string = processes.result.entries.find((r: { _tag: string }) => r._tag === "started").body.process;
    let letters = 0;
    return {
      pid,
      call: (method: string, params: unknown) => rpc(p, method, params),
      press: (type: "inc" | "dec") =>
        rpc(p, "process.send", {
          pid,
          letter: `press-${++letters}`,
          m: { type },
          sentAt: "2026-11-11T04:00:00.000Z",
          seen: 0,
        }),
      view: () => Effect.map(rpc(p, "view.open", { pid }), (r) => r.result.view),
      read: (stream: string) =>
        Effect.map(rpc(p, "ledger.read", { stream, after: 0 }), (r) => (r.result?.entries ?? []) as ReadonlyArray<any>),
    };
  });

/** The counter's source with `inc` adding `k`, and with any change a law asks for. */
const edited = (source: string, k: number, more: (s: string) => string = (s) => s) =>
  more(source.replace("inc: (s) => [{ count: s.count + 1 }, []]", `inc: (s) => [{ count: s.count + ${k} }, []]`));

describe("P15 slice 1: hot reload on the real instance", () => {
  // L17: the real build's warning printer, including importers outside the project root.
  it("L17: build warnings keep unresolved imports visible without absolute paths for generated roots", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          folder: fc.stringMatching(/^[a-z][a-z0-9 -]{1,24}$/),
          missing: fc.stringMatching(/^[a-z]{4,16}$/),
        }),
        ({ folder, missing }) =>
          scoped(
            Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const path = yield* Path.Path;
              const home = yield* fs.makeTempDirectoryScoped({ directory: "/tmp", prefix: "p15log." });
              const root = path.join(home, folder);
              const dependency = path.join(home, "dependency");
              yield* fs.makeDirectory(root, { recursive: true });
              yield* fs.makeDirectory(dependency, { recursive: true });
              const entry = path.join(root, "brain.ts");
              const imported = path.join(dependency, "imported.ts");
              const specifiers = [`p15-missing-${missing}`, `p15-dependency-${missing}`];
              yield* fs.writeFileString(
                entry,
                `import ${JSON.stringify(specifiers[0])}; import "../dependency/imported.ts";\n`,
              );
              yield* fs.writeFileString(imported, `import ${JSON.stringify(specifiers[1])};\n`);
              const warnings = yield* Effect.acquireRelease(
                Effect.sync(() => vi.spyOn(console, "warn").mockImplementation(() => {})),
                (spy) => Effect.sync(() => spy.mockRestore()),
              );
              yield* build({
                root,
                entry,
                out: path.join(home, "out"),
                programs: [],
                files: [],
                ledger: [],
                chaos: false,
              });
              const printed = warnings.mock.calls.map((args) => args.map(String).join(" ")).join("\n");

              for (const specifier of specifiers) {
                expect(printed.includes(specifier), "the unresolved import warning is still printed").toBe(true);
              }

              for (const file of [entry, imported]) {
                expect(
                  printed.includes(path.relative(root, file)),
                  "the warning names its importer relative to root",
                ).toBe(true);
              }

              for (const forbidden of [home, yield* fs.realPath(home)]) {
                for (const form of [forbidden, JSON.stringify(forbidden).slice(1, -1), encodeURIComponent(forbidden)]) {
                  expect(printed.includes(form), "a printed warning holds an absolute path").toBe(false);
                }
              }

              // The real brain reaches dependencies whose diagnostic frames differ from simple imports.
              const copy = yield* fixture;
              yield* fixtureBuild(copy, path.join(home, "instance-build"));
              const actual = warnings.mock.calls.map((args) => args.map(String).join(" ")).join("\n");

              for (const forbidden of [ROOT, yield* fs.realPath(ROOT), home, copy.home]) {
                for (const form of [forbidden, JSON.stringify(forbidden).slice(1, -1), encodeURIComponent(forbidden)]) {
                  expect(actual.includes(form), "the real brain build printed an absolute path").toBe(false);
                }
              }
            }),
          ),
      ),
      { seed: 119120, numRuns: 10, endOnFailure: true },
    );
  });

  // L16. Plant: rebuild the brain file instead of installing (workerd restarts, the T421 watch fires).
  it("scenario: L16, the real path: a fitting save keeps the count and the next press runs the new code; a refused save and a syntax error leave it running; a later good save swaps", async () => {
    await scoped(
      Effect.gen(function* () {
        const source = yield* counterSource;
        expect(source, "the counter's inc this scenario edits").toContain("inc: (s) => [{ count: s.count + 1 }, []]");
        const copy = yield* fixture;
        const run = yield* instance(copy);
        // The watcher's first build is the boot's own bytes: nothing to swap.
        expect(outcome(yield* nextAnswer(run.answers))).toEqual({ _tag: "same" });
        // L2 permits late notifications of unchanged bytes. They do not answer the next distinct save.
        const changed = () => nextAnswer(run.answers, 60_000, (answer) => outcome(answer)._tag !== "same");
        const s = yield* session(run.url, run.founder.key);

        for (let n = 0; n < 3; n++) {
          yield* s.press("inc");
        }

        expect(yield* s.view()).toEqual({ count: 3 });

        // A save that fits: inc adds 2. The count stays, and the next press runs the new code.
        yield* copy.write(edited(source, 2));
        expect(outcome(yield* changed())).toMatchObject({ _tag: "swapped" });
        expect(yield* s.view()).toEqual({ count: 3 });
        yield* s.press("inc");
        expect(yield* s.view()).toEqual({ count: 5 });
        const stream = yield* s.read(s.pid);
        const swapped = stream.filter((e) => e._tag === "code.swapped");
        expect(swapped).toHaveLength(1);
        expect(stream.filter((e) => e._tag === "stepped").at(-1)?.body.build).toBe(swapped[0].body.hash);

        // A save the counter's state cannot be read by: a new field, the same `v`, no upgrade.
        yield* copy.write(
          edited(source, 2, (s) =>
            s.replace("Schema.Struct({ count: Schema.Int })", "Schema.Struct({ count: Schema.Int, step: Schema.Int })"),
          ),
        );
        expect(outcome(yield* changed())).toEqual({
          _tag: "refused",
          was: swapped[0].body.hash,
          reason: "shape",
        });
        yield* s.press("inc");
        expect(yield* s.view(), "the old code keeps running it").toEqual({ count: 7 });

        // A syntax error: nothing reaches the process; the brain records where.
        yield* copy.write(`${source}\nexport const broken = ;\n`);
        expect(outcome(yield* changed())).toMatchObject({ _tag: "failed", reason: "bundle" });
        const failed = (yield* s.read("gateway/code")).filter((e) => e._tag === "code.failed").at(-1);
        expect(failed?.body).toMatchObject({ program: PROGRAM, hash: null, reason: "bundle", path: copy.relative });
        expect(typeof failed?.body.line).toBe("number");
        yield* s.press("inc");
        expect(yield* s.view()).toEqual({ count: 9 });

        // Its fix: inc adds 3, and it swaps.
        yield* copy.write(edited(source, 3));
        expect(outcome(yield* changed())).toMatchObject({ _tag: "swapped" });
        yield* s.press("inc");
        expect(yield* s.view()).toEqual({ count: 12 });
      }),
    );
  }, 600_000);

  // L17 [secrets]. Plant: put the compiler's message in code.failed; print the token in the install line.
  it("L17: no code fact, answer or error copies program source or an absolute path, and code.failed's path is relative, for generated sentinels in the source and its error", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          word: fc.stringMatching(/^[A-Z]{12}$/),
          k: fc.integer({ min: 2, max: 9 }),
          line: fc.integer({ min: 0, max: 20 }),
        }),
        ({ word, k, line }) =>
          scoped(
            Effect.gen(function* () {
              const sentinel = `P15SECRET${word}`;
              const source = yield* counterSource;
              const copy = yield* fixture;
              const run = yield* instance(copy);
              const answers: Array<unknown> = [yield* nextAnswer(run.answers)];
              const changed = () =>
                nextAnswer(run.answers, 60_000, (answer) => {
                  // Inspect every answer for L17, including late same-hash notifications from L2.
                  answers.push(answer);
                  return outcome(answer)._tag !== "same";
                });
              const s = yield* session(run.url, run.founder.key);
              yield* s.press("inc");
              // The sentinel in the source the bundle carries, then in the line its error names.
              yield* copy.write(edited(source, k, (t) => `${t}\nglobalThis.__p15 = ${JSON.stringify(sentinel)};\n`));
              yield* changed();
              yield* copy.write(
                `${source}${"\n".repeat(line)}\nexport const broken = ${JSON.stringify(sentinel)} +;\n`,
              );
              yield* changed();
              const outputs = [
                ...answers.map((a) => JSON.stringify(a)),
                ...(yield* s.read("gateway/code")).map((e) => JSON.stringify(e)),
                ...(yield* s.read(s.pid)).map((e) => JSON.stringify(e)),
              ];
              const forbidden = [sentinel, run.home, copy.home, ROOT];

              for (const output of outputs) {
                for (const text of forbidden) {
                  for (const form of [text, JSON.stringify(text).slice(1, -1), encodeURIComponent(text)]) {
                    expect(
                      output.includes(form),
                      `an output holds ${text === sentinel ? "the sentinel" : "a path"}`,
                    ).toBe(false);
                  }
                }
              }

              const failed = (yield* s.read("gateway/code")).filter((e) => e._tag === "code.failed");
              expect(failed.map((e) => e.body.path)).toEqual([copy.relative]);
            }),
          ),
      ),
      { seed: 119120, numRuns: 10, endOnFailure: true },
    );
  }, 1_800_000);

  it("L17: generated save flows keep source, made-up bearer and absolute paths out of dev's actual printed lines, errors and persisted spans", async () => {
    const cliMoves = new Set<string>();
    await fc.assert(
      fc.asyncProperty(fc.gen(), (g) =>
        scoped(
          Effect.gen(function* () {
            const word = g(() => fc.stringMatching(/^[A-Z]{12}$/));
            const sentinel = `P15SECRET${word}"/+`;
            const fakeBytes = g(() => fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 32, maxLength: 32 }));
            const fakeBearer = Base64Url.encode(Uint8Array.from(fakeBytes));
            const source = yield* counterSource;
            const copy = yield* fixture;
            const fs = yield* FileSystem.FileSystem;
            yield* fs.writeFileString(
              `${copy.home}/counter/src/view.tsx`,
              `export function Bad() { "use no memo"; return <div>{${JSON.stringify(`${sentinel} ${fakeBearer} ${copy.file}`)}}</div>; }\nglobalThis.__p15View = Bad;\n`,
            );
            const run = yield* cli(copy, fakeBytes);
            const s = yield* session(run.url, run.founder.key);
            const initialSpans = yield* spanOutputs(run.home).pipe(
              Effect.map(rebuildSpans),
              Effect.repeat({ until: (spans) => spans.length > 0, schedule: Schedule.spaced("50 millis") }),
              Effect.timeout("60 seconds"),
            );
            const recorded = new Set(initialSpans.map((span) => span.spanId));
            let k = 1;
            let count = 0;
            const steps = g(fc.integer, { min: 4, max: 8 });
            const seen = new Set<string>();

            for (let n = 0; n < steps; n++) {
              // Each move uses the code and count reached so far. Failures leave both running values alone.
              const moves = ["fit", "shape", "syntax", "load", "compiler"];
              const move = moves[g(fc.nat, { max: moves.length - 1 })]!;
              const next = k + g(fc.integer, { min: 1, max: 5 });
              const message = `${sentinel} ${fakeBearer} ${copy.file}`;
              // L12's real door path: even a granted person cannot invoke the control-only calls.
              const method = g(() => fc.constantFrom("codeInstall", "codeFailed"));
              const denied = yield* s.call(method, { program: PROGRAM, source: message, hash: null, reason: "load" });
              expect(denied.error?.data?.reason).toBe("unknown_method");
              let text = edited(
                source,
                next,
                // Rolldown's duplicate-key warning quotes this line, including its private inputs.
                (t) =>
                  `${t}\nglobalThis.__p15 = {${JSON.stringify(message)}: 1, ${JSON.stringify(message)}: 2};\nglobalThis.__p15Edit = ${n};\n`,
              );

              if (move === "shape") {
                text = text.replace(
                  "Schema.Struct({ count: Schema.Int })",
                  "Schema.Struct({ count: Schema.Int, step: Schema.Int })",
                );
              } else if (move === "syntax") {
                text += `\nexport const broken = ${JSON.stringify(message)} +;\n`;
              } else if (move === "load") {
                text += `\nthrow new Error(${JSON.stringify(message)});\n`;
              } else if (move === "compiler") {
                text += '\nimport "./view.tsx";\n';
              }

              yield* copy.write(text);
              const printed = yield* run.nextLine(
                (line) => line.startsWith("counter:1 ") || line.startsWith(`${PROGRAM} did not load:`),
              );
              expect(printed.length).toBeGreaterThan(0);
              seen.add(move);

              if (move === "fit") {
                k = next;
              }

              yield* s.press("inc");
              count += k;
              expect(yield* s.view()).toEqual({ count });
              const facts = [...(yield* s.read("gateway/code")), ...(yield* s.read(s.pid))];
              const spans = yield* spanOutputs(run.home);
              expect(spans.length, "the real span sink wrote output").toBeGreaterThan(0);
              const rebuilt = rebuildSpans(spans).filter((span) => !recorded.has(span.spanId));
              expect(
                rebuilt.length,
                "dev saves the watcher's completed rebuild, not only control-call spans",
              ).toBeGreaterThan(0);
              const expectedOutcome = ["fit", "shape"].includes(move) ? "loaded" : "failed";
              expect(rebuilt.some((span) => span.attributes.outcome === expectedOutcome)).toBe(true);

              for (const span of rebuilt) {
                expect(span.attributes.program).toBe(PROGRAM);
                // A late file event may also rebuild the same bytes (L2).
                expect([expectedOutcome, "same"]).toContain(span.attributes.outcome);
                expect(span.attributes.bytes).toEqual(expect.any(Number));
                expect(Number(span.attributes.bytes)).toBeGreaterThanOrEqual(0);
                expect(span.attributes.ms).toEqual(expect.any(Number));
                expect(Number(span.attributes.ms)).toBeGreaterThanOrEqual(0);
                recorded.add(span.spanId);
              }

              const outputs = [
                JSON.stringify(denied),
                JSON.stringify(facts),
                JSON.stringify(spans),
                ...run.stdout,
                ...run.stderr,
              ];

              for (const output of outputs) {
                for (const forbidden of [sentinel, fakeBearer, copy.home, run.home, ROOT, text]) {
                  for (const form of [
                    forbidden,
                    JSON.stringify(forbidden).slice(1, -1),
                    encodeURIComponent(forbidden),
                  ]) {
                    expect(output.includes(form), "a named output copied private input").toBe(false);
                  }
                }
              }

              // The plan's L17 row: the path is repo-relative. A bundle error names the file it is in,
              // which may be a file the program imports, so the path lies in the program's folder.
              const folder = copy.relative.slice(0, copy.relative.indexOf("/") + 1);

              for (const fact of facts.filter((e) => e._tag === "code.failed" && e.body.path !== undefined)) {
                const named = String(fact.body.path);
                const relative =
                  !named.startsWith("/") &&
                  !/^[A-Za-z]:/.test(named) &&
                  !named.split(/[/\\]/).includes("..") &&
                  !named.includes(copy.home);
                expect(
                  relative && named.startsWith(folder),
                  `code.failed's path is repo-relative and inside ${folder}: ${named}`,
                ).toBe(true);
              }
            }

            // A generated run may omit a failure class; all ten walks together must exercise them.
            for (const move of seen) {
              cliMoves.add(move);
            }
          }),
        ),
      ),
      { seed: 119120, numRuns: 10, endOnFailure: true },
    );
    expect(cliMoves).toEqual(new Set(["fit", "shape", "syntax", "load", "compiler"]));
  }, 1_800_000);
});
