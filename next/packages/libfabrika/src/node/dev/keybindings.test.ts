// P14, next/ (Tier 1, ticket 286): the Node key-file reader (the plan's "Layout and key tables").
// Written before `node/dev/keybindings.ts`; the module loads by `import()` in each test.
//
// The shape these laws hold the module to, from the plan's words (the build may add more):
// - `watchKeys({file, commands, defaults, publish, status})`: an Effect needing `FileSystem` and a
//   `Scope`. It reads the file once before it returns, then watches it for the life of the scope.
// - Each good read calls `publish({rows, source: "file"})` with the rows `parseKeys` made, then
//   `status({error: null})`. A bad file or a failed read calls `status({error: {line, reason}})` and
//   publishes nothing. A failed watcher calls `status({error: {reason: "watch", ...}})`.
// - Closing the scope stops the watcher: no read, publish or status happens after it.
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Queue, Ref, Scope, Stream } from "effect";
import * as fc from "fast-check";

const SEED = 119120;
const LOAD = "./keybindings.ts";
const COMMANDS = ["counter.inc", "counter.dec", "counter.reset"] as const;

type Status = { readonly error: { readonly line: number; readonly reason: string } | null };

type Watch = (o: {
  file: string;
  commands: ReadonlyArray<string>;
  defaults: unknown;
  publish: (v: { rows: unknown; source: "file" }) => Effect.Effect<void>;
  status: (s: Status) => Effect.Effect<void>;
}) => Effect.Effect<void, never, FileSystem.FileSystem | Scope.Scope>;

/** One thing that happens to the file after the reader starts. */
type Step =
  | { readonly _tag: "good"; readonly keys: ReadonlyArray<string> }
  | { readonly _tag: "bad" }
  | { readonly _tag: "unreadable" }
  | { readonly _tag: "watcher_fails" };

const steps: fc.Arbitrary<ReadonlyArray<Step>> = fc.array(
  fc.oneof(
    {
      weight: 4,
      arbitrary: fc
        .array(fc.constantFrom("a", "b", "x", "=", "["), { maxLength: 2 })
        .map((keys): Step => ({ _tag: "good", keys: [...new Set(keys)] })),
    },
    { weight: 3, arbitrary: fc.constant<Step>({ _tag: "bad" }) },
    { weight: 2, arbitrary: fc.constant<Step>({ _tag: "unreadable" }) },
    { weight: 1, arbitrary: fc.constant<Step>({ _tag: "watcher_fails" }) },
  ),
  { minLength: 1, maxLength: 12 },
);

const text = (keys: ReadonlyArray<string>): string => `[keys]\n"counter.inc" = ${JSON.stringify(keys)}\n`;

/** Runs the reader on a fake file system, plays `list`, and answers what it published and said. */
const play = (watch: Watch, list: ReadonlyArray<Step>, closeAfter: number = list.length) =>
  Effect.gen(function* () {
    const content = yield* Ref.make<string | "unreadable">(text(["a"]));
    const events = yield* Queue.unbounded<"change" | "fail">();
    const published = yield* Ref.make<ReadonlyArray<unknown>>([]);
    const statuses = yield* Ref.make<ReadonlyArray<Status>>([]);
    const reads = yield* Ref.make(0);
    const fs = FileSystem.layerNoop({
      readFileString: () =>
        Ref.update(reads, (n) => n + 1).pipe(
          Effect.andThen(Ref.get(content)),
          Effect.flatMap((c) => (c === "unreadable" ? Effect.fail("EACCES" as never) : Effect.succeed(c))),
        ) as never,
      watch: () =>
        Stream.fromQueue(events).pipe(
          Stream.mapEffect((e) => (e === "fail" ? Effect.fail("watch failed" as never) : Effect.void)),
        ) as never,
    });
    const scope = yield* Scope.make();
    yield* watch({
      file: "keybindings.toml",
      commands: COMMANDS,
      defaults: {},
      publish: (v) => Ref.update(published, (all) => [...all, v.rows]),
      status: (s) => Ref.update(statuses, (all) => [...all, s]),
    }).pipe(Effect.provide(fs), Scope.provide(scope));
    const model: Array<unknown> = [{ "counter.inc": ["a"] }];

    for (const [n, step] of list.entries()) {
      if (n === closeAfter) {
        yield* Scope.close(scope, { _tag: "Success", value: undefined } as never);
      }

      if (step._tag === "good") {
        yield* Ref.set(content, text(step.keys));

        if (n < closeAfter) {
          model.push({ "counter.inc": step.keys });
        }
      } else if (step._tag === "bad") {
        yield* Ref.set(content, `[keys]\n"no.such" = ["a"]\n`);
      } else if (step._tag === "unreadable") {
        yield* Ref.set(content, "unreadable");
      }

      yield* Queue.offer(events, step._tag === "watcher_fails" ? "fail" : "change");
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
    }

    if (closeAfter >= list.length) {
      yield* Scope.close(scope, { _tag: "Success", value: undefined } as never);
    }

    return {
      published: yield* Ref.get(published),
      statuses: yield* Ref.get(statuses),
      model,
      reads: yield* Ref.get(reads),
    };
  });

const lawOne = (watch: Watch, list: ReadonlyArray<Step>) =>
  Effect.gen(function* () {
    const trimmed: Array<Step> = [];

    for (const s of list) {
      trimmed.push(s);

      if (s._tag === "watcher_fails") {
        break;
      } // a failed watcher is the end of that watch
    }

    const out = yield* play(watch, trimmed);
    expect(out.published).toEqual(out.model);
    const last = out.statuses.at(-1);
    const final = trimmed.filter((s) => s._tag !== "watcher_fails").at(-1);

    if (trimmed.at(-1)?._tag === "watcher_fails") {
      expect(last?.error?.reason).toBe("watch");
    } else if (final?._tag === "good" || final === undefined) {
      expect(last?.error).toBeNull();
    } else {
      expect(last?.error).not.toBeNull();
    }
  });

const lawTwo = (watch: Watch, list: ReadonlyArray<Step>, at: number) =>
  Effect.gen(function* () {
    const closeAfter = at % list.length;
    const out = yield* play(
      watch,
      list.filter((s) => s._tag !== "watcher_fails"),
      closeAfter,
    );
    expect(out.published).toEqual(out.model);
    expect(out.reads).toBeLessThanOrEqual(1 + closeAfter); // the first read, then one per change before the close
  });

const check = (run: (list: ReadonlyArray<Step>, at: number) => Effect.Effect<void, unknown, never>) =>
  fc.assert(
    fc.asyncProperty(steps, fc.nat(11), (list, at) => Effect.runPromise(run(list, at))),
    { seed: SEED, numRuns: 100 },
  );

const load = async (): Promise<Watch> => ((await import(LOAD)) as { watchKeys: Watch }).watchKeys;

describe("key file reader: validated publication, visible failures, scoped cleanup", () => {
  it("each good read is published once, in order; a bad or unreadable one publishes nothing and says why", async () => {
    const watch = await load();
    await check((list) => lawOne(watch, list));
  });
  it("closing the scope stops the watcher: nothing is read or published after it", async () => {
    const watch = await load();
    await check((list, at) => lawTwo(watch, list, at));
  });

  // Plants (node keys): publish a bad file; drop the failure status. A reader that outlives its scope has no
  // wrapper plant, since its fork cannot be wrapped from outside; it was run by hand on a reference reader that
  // forked into the global scope, and the second law failed on it.
  it("plant: a reader that publishes a file it could not validate is caught", async () => {
    const real = await load();
    const broken: Watch = (o) => real({ ...o, commands: [...o.commands, "no.such"] });
    await expect(check((list) => lawOne(broken, list))).rejects.toThrow();
  });
  it("plant: a reader that drops its failure status is caught", async () => {
    const real = await load();
    const broken: Watch = (o) => real({ ...o, status: (s) => (s.error === null ? o.status(s) : Effect.void) });
    await expect(check((list) => lawOne(broken, list))).rejects.toThrow();
  });
});

// Review 1, C, [secrets]: a settings error keeps the line and the reason, never the file's text. A
// person's key file holds a made-up secret (a pass or a token pasted by mistake) in a comment, as an
// unknown command, as a key name, or on a line that does not parse. Neither the status nor any
// published table holds any form of it (as is, base64, hex, URI-encoded). The plant puts the secret
// into each output, and the same check must name it.
describe("[secrets] key file reader: an error keeps its line and reason, never the file's text", () => {
  const forms = (secret: string): ReadonlyArray<string> => [
    secret,
    Buffer.from(secret).toString("base64"),
    Buffer.from(secret).toString("hex"),
    encodeURIComponent(secret),
  ];
  const leaks = (secret: string, outputs: Readonly<Record<string, string>>): ReadonlyArray<string> =>
    Object.entries(outputs)
      .filter(([, text]) => forms(secret).some((f) => text.includes(f)))
      .map(([name]) => name);
  const files = (secret: string): ReadonlyArray<string> => [
    `# ${secret}\n[keys]\n"counter.inc" = ["a"]\n`,
    `[keys]\n"${secret}" = ["a"]\n`,
    `[keys]\n"counter.inc" = ["${secret}"]\n`,
    `[keys]\n${secret} = = [\n`,
    `${secret}\n`,
  ];

  it("no status and no published table holds the secret, whatever the file", async () => {
    const watch = await load();
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^[A-Za-z0-9]{16,24}$/), fc.nat(4), async (word, which) => {
        const secret = `pass-${word}`;
        const content = files(secret)[which]!;
        const published: Array<unknown> = [];
        const statuses: Array<Status> = [];
        await Effect.runPromise(
          Effect.scoped(
            watch({
              file: "keybindings.toml",
              commands: COMMANDS,
              defaults: {},
              publish: (v) => Effect.sync(() => void published.push(v)),
              status: (s) => Effect.sync(() => void statuses.push(s)),
            }).pipe(
              Effect.provide(
                FileSystem.layerNoop({
                  readFileString: () => Effect.succeed(content),
                  watch: () => Stream.empty,
                }),
              ),
            ),
          ),
        );
        const outputs = { published: JSON.stringify(published), statuses: JSON.stringify(statuses) };
        // Good thing: the reader read the file and said something about it.
        expect(statuses.length + published.length).toBeGreaterThan(0);
        expect(leaks(secret, outputs)).toEqual([]);

        for (const name of Object.keys(outputs)) {
          const planted = { ...outputs, [name]: `${outputs[name as keyof typeof outputs]}${secret}` };
          expect(leaks(secret, planted), `a leak planted in ${name}`).toEqual([name]);
        }
      }),
      { seed: SEED, numRuns: 100 },
    );
  });
});
