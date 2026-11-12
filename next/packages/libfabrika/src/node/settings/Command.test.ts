// T730, P38 slice 2, next/: L7 and L8 [secrets] of the approved plan, for `node/settings/Command.ts`
// run as a real Effect CLI command. Written before the module.
//
// The shape these tests hold the module to:
// - `Command.make({ version })` is an `effect/cli` command named `settings`, with one flag per
//   declaration at its path (`--instance.port`) and `--all`. It needs the CLI's own environment
//   (`FileSystem`, `Path`, `Terminal`, `ChildProcessSpawner`, `Stdio`), `Toml` and `Digest`.
// - It reads its environment through Effect's `ConfigProvider`, and only each declaration's `env`
//   name, `FABRIKA_HOME` and `HOME`. The person's file is `$FABRIKA_HOME/fabrika.toml`, named
//   `$FABRIKA_HOME/fabrika.toml`, or else `$HOME/.fabrika/fabrika.toml`, named
//   `~/.fabrika/fabrika.toml`, as dev.ts names it. It selects no repo, so it reads no repo file.
// - It calls `Load.load` once, builds the whole report, then prints it through `Console`: what
//   `Print.report(Reference.rows(Declarations.all, snapshot), { all })` gives for that load. A
//   failed load prints no report and fails the command. It writes nothing and starts nothing.
//
// The home is `/t730`, a made-up folder that exists only in the counted FileSystem below.
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Logger,
  PlatformError,
  References,
  Sink,
  Stream,
  Tracer,
} from "effect";
import { Command as Cli } from "effect/cli";
import { Digest } from "effect/crypto";
import { TestConsole } from "effect/testing";
import * as fc from "fast-check";
import * as Declarations from "../../settings/Declarations.ts";
import * as Print from "../../settings/Print.ts";
import * as Reference from "../../settings/Reference.ts";
import * as TomlParser from "../../settings/TomlParser.ts";
import * as Command from "./Command.ts";
import * as Load from "./Load.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const check = { seed: SEED, numRuns: 100 };
// T753 L8 and L9 reuse these complete command flows, with every output captured below.
const VERSION = "0.0.0";
const HOME = "/t730";

type Person =
  | { readonly _tag: "missing" }
  | { readonly _tag: "text"; readonly text: string }
  | { readonly _tag: "unreadable" };

interface Counts {
  /** Every path a read-side operation was asked for, in order. */
  readonly touched: Array<string>;
  /** Reads of the person's file. */
  reads: number;
  /** Every write-side operation called, by name. */
  readonly writes: Array<string>;
}

const missing = (method: string, path: string) =>
  PlatformError.systemError({ _tag: "NotFound", module: "FileSystem", method, pathOrDescriptor: path });

/**
 * A FileSystem that holds only the person's file at `at`, counts every read and refuses every
 * write. A repo's file anywhere, the current folder's included, would hold a key no setting has.
 */
const files = (at: string, person: Person, counts: Counts) => {
  const look = (method: string) => (path: string) => {
    counts.touched.push(path);
    return Effect.fail(missing(method, path));
  };
  const wrote = (method: string) => () => {
    counts.writes.push(method);
    return Effect.die(new Error(`the settings command wrote with ${method}`));
  };
  return FileSystem.layerNoop({
    readFileString: (path) => {
      counts.touched.push(path);

      if (path === at) {
        counts.reads++;
        return person._tag === "text"
          ? Effect.succeed(person.text)
          : person._tag === "unreadable"
            ? Effect.fail(
                PlatformError.systemError({
                  _tag: "PermissionDenied",
                  module: "FileSystem",
                  method: "readFileString",
                  pathOrDescriptor: path,
                }),
              )
            : Effect.fail(missing("readFileString", path));
      }

      return path.endsWith(".fabrika/fabrika.toml")
        ? Effect.succeed("[nope]\nkey = 1\n")
        : Effect.fail(missing("readFileString", path));
    },
    readFile: look("readFile"),
    exists: (path) => {
      counts.touched.push(path);
      return Effect.succeed(false);
    },
    stat: look("stat"),
    lstat: look("lstat"),
    access: look("access"),
    readDirectory: look("readDirectory"),
    readDirectoryEntries: look("readDirectoryEntries"),
    readLink: look("readLink"),
    realPath: look("realPath"),
    stream: (path) => {
      counts.touched.push(path);
      return Stream.fail(missing("stream", path));
    },
    watch: (path) => {
      counts.touched.push(path);
      return Stream.fail(missing("watch", path));
    },
    writeFile: wrote("writeFile"),
    writeFileString: wrote("writeFileString"),
    makeDirectory: wrote("makeDirectory"),
    makeTempDirectory: wrote("makeTempDirectory"),
    makeTempDirectoryScoped: wrote("makeTempDirectoryScoped"),
    makeTempFile: wrote("makeTempFile"),
    makeTempFileScoped: wrote("makeTempFileScoped"),
    remove: wrote("remove"),
    rename: wrote("rename"),
    copy: wrote("copy"),
    copyFile: wrote("copyFile"),
    symlink: wrote("symlink"),
    link: wrote("link"),
    truncate: wrote("truncate"),
    chmod: wrote("chmod"),
    chown: wrote("chown"),
    utimes: wrote("utimes"),
    open: wrote("open"),
    sink: () => {
      counts.writes.push("sink");
      return Sink.die(new Error("the settings command wrote with sink"));
    },
  });
};

/** Spans, as their names, attributes, events and status. */
const spans = () => {
  const ended: Array<Tracer.NativeSpan> = [];
  const tracer = Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options);
      ended.push(span);
      return span;
    },
  });
  const text = () =>
    ended
      .map((span) =>
        JSON.stringify(
          { name: span.name, attributes: [...span.attributes], events: span.events, status: span.status },
          (_key, value: unknown) => (typeof value === "bigint" ? String(value) : value),
        ),
      )
      .join("\n");
  return { tracer, text };
};

/** Every log entry at every level, with its fields and cause. */
const logs = () => {
  const entries: Array<string> = [];
  const logger = Logger.make((options) => {
    entries.push(
      JSON.stringify({
        message: options.message,
        level: options.logLevel,
        cause: Cause.pretty(options.cause),
        fields: options.fiber.getRef(References.CurrentLogAnnotations),
      }),
    );
  });
  return { layer: Logger.layer([logger]), entries };
};

interface Input {
  readonly args: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string>>;
  readonly person: Person;
}

/** Where the command must find the person's file, and the name a person reads for it. */
const place = (env: Readonly<Record<string, string>>) =>
  env.FABRIKA_HOME === undefined
    ? { path: `${env.HOME}/.fabrika/fabrika.toml`, name: "~/.fabrika/fabrika.toml" }
    : { path: `${env.FABRIKA_HOME}/fabrika.toml`, name: "$FABRIKA_HOME/fabrika.toml" };

/** One run of `settings` with these arguments, environment and person's file, everything it said. */
const run = (input: Input) => {
  const counts: Counts = { touched: [], reads: 0, writes: [] };
  const traced = spans();
  const logged = logs();
  return Effect.gen(function* () {
    const exit = yield* Cli.runWith(Command.make({ version: VERSION }), { version: VERSION })(input.args).pipe(
      Effect.withTracer(traced.tracer),
      Effect.exit,
    );
    const stdout = (yield* TestConsole.logLines).map(String);
    const stderr = (yield* TestConsole.errorLines).map(String);
    return { exit, stdout, stderr, counts, spans: traced.text(), logs: logged.entries };
  }).pipe(
    Effect.provideService(References.MinimumLogLevel, "All"),
    Effect.provide(
      Layer.mergeAll(
        files(place(input.env).path, input.person, counts),
        TestConsole.layer,
        TomlParser.layer,
        Digest.layerWebCrypto,
        logged.layer,
        ConfigProvider.layer(ConfigProvider.fromEnv({ env: { ...input.env } })),
      ),
    ),
    Effect.provide(NodeServices.layer),
    Effect.runPromise,
  );
};

/** The oracle: the library's own load and report for the same inputs. */
const expected = (input: Input, flags: Readonly<Record<string, string>>, all: boolean) => {
  const counts: Counts = { touched: [], reads: 0, writes: [] };
  const at = place(input.env);
  const env = Object.fromEntries(
    Declarations.all.declarations.flatMap((d) => (input.env[d.env] === undefined ? [] : [[d.env, input.env[d.env]!]])),
  );
  return Load.load({ person: at, flags, env, version: VERSION }).pipe(
    Effect.map((loaded) => Print.report(Reference.rows(Declarations.all, loaded.snapshot), { all })),
    Effect.exit,
    Effect.provide(Layer.mergeAll(files(at.path, input.person, counts), TomlParser.layer, Digest.layerWebCrypto)),
    Effect.provide(NodeServices.layer),
    Effect.runPromise,
  );
};

const port = fc.integer({ min: 1, max: 65535 });
const badPort = fc.oneof(fc.integer({ min: 65536, max: 2 ** 30 }), fc.integer({ min: -(2 ** 30), max: 0 }));

// The person's file: missing, empty, a valid port, or each way it can fail to load.
const person = fc.oneof(
  fc.constant<Person>({ _tag: "missing" }),
  fc.constant<Person>({ _tag: "text", text: "" }),
  port.map((p): Person => ({ _tag: "text", text: `# the person's\n\n[instance]\nport = ${p}\n` })),
  badPort.map((p): Person => ({ _tag: "text", text: `[instance]\nport = ${p}\n` })),
  fc.constantFrom<Person>(
    { _tag: "text", text: "[instance]\nprot = 18800\n" },
    { _tag: "text", text: "[instance\nport = 1\n" },
    { _tag: "text", text: 'fabrika-version = "0.0.0"\n' },
    { _tag: "unreadable" },
  ),
);

// Declared values, as a flag or in the environment, valid or not.
const value = fc.oneof(port.map(String), badPort.map(String));
const version = fc.constantFrom("0.0.0", "0.0.1", "nope");

const inputs = fc.record({
  person,
  home: fc.constantFrom("fabrika-home", "home"),
  all: fc.boolean(),
  flagPort: fc.option(value, { nil: undefined }),
  flagVersion: fc.option(version, { nil: undefined }),
  envPort: fc.option(value, { nil: undefined }),
  envVersion: fc.option(version, { nil: undefined }),
});

it("T753 L8 explicit values equal to defaults remain visible without all", async () => {
  await fc.assert(
    fc.asyncProperty(fc.record({ viaEnv: fc.boolean(), all: fc.boolean() }), async (v) => {
      const d = Declarations.port;
      const ran = await run({
        args: [...(v.all ? ["--all"] : []), ...(v.viaEnv ? [] : [`--${d.path}=${d.default}`])],
        env: { HOME, ...(v.viaEnv ? { [d.env]: String(d.default) } : {}) },
        person: { _tag: "text", text: `[instance]\nport = ${d.default}\n` },
      });
      expect(Exit.isSuccess(ran.exit)).toBe(true);
      expect(ran.counts.reads).toBe(1);
      expect(ran.stdout.join("\n")).toContain(`${d.path} = ${JSON.stringify(d.default)}`);
      expect(ran.stdout.join("\n")).toContain(v.viaEnv ? d.env : `--${d.path}`);
      expect(ran.counts.writes).toEqual([]);
    }),
    check,
  );
});

type Generated = typeof inputs extends fc.Arbitrary<infer I> ? I : never;

const shape = (g: Generated) => {
  const flags: Record<string, string> = {
    ...(g.flagPort === undefined ? {} : { [Declarations.port.path]: g.flagPort }),
    ...(g.flagVersion === undefined ? {} : { [Declarations.version.path]: g.flagVersion }),
  };
  const env: Record<string, string> = {
    HOME,
    ...(g.home === "fabrika-home" ? { FABRIKA_HOME: `${HOME}/f` } : {}),
    ...(g.envPort === undefined ? {} : { [Declarations.port.env]: g.envPort }),
    ...(g.envVersion === undefined ? {} : { [Declarations.version.env]: g.envVersion }),
  };
  const args = [...(g.all ? ["--all"] : []), ...Object.entries(flags).map(([path, v]) => `--${path}=${v}`)];
  return { input: { args, env, person: g.person }, flags };
};

/** Whether a line of output is a report row: it starts with a declared path. */
const row = (line: string) =>
  line.split("\n").some((l) => Declarations.all.declarations.some((d) => l.trimStart().startsWith(d.path)));

describe("L7, the command loads once, prints only after success, selects no repo and writes nothing", () => {
  it("a run prints the library's report for its load, or fails with no report; it reads only the person's file", async () => {
    await fc.assert(
      fc.asyncProperty(inputs, async (g) => {
        const { input, flags } = shape(g);
        const ran = await run(input);
        const oracle = await expected(input, flags, g.all);
        const at = place(input.env).path;

        // One load, of the person's file alone: never the current folder's repo file.
        expect(ran.counts.reads, JSON.stringify(input)).toBe(1);
        expect(
          ran.counts.touched.every((p) => p === at),
          ran.counts.touched.join(", "),
        ).toBe(true);
        expect(ran.counts.writes).toEqual([]);
        expect(Exit.isSuccess(ran.exit), JSON.stringify(input)).toBe(Exit.isSuccess(oracle));

        if (Exit.isSuccess(oracle)) {
          expect(ran.stdout.join("\n")).toContain(oracle.value.trimEnd());
        } else {
          // A failed load prints no row, not even a valid flag's.
          expect(ran.stdout.some(row), ran.stdout.join("\n")).toBe(false);
        }
      }),
      check,
    );
  });
});

/** Every form a secret may take in text: raw, JSON-escaped and URL-encoded. */
const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

// Made-up secrets with the characters that make the three forms differ.
const secret = fc
  .tuple(fc.stringMatching(/^[A-Za-z0-9]{6,12}$/), fc.constantFrom('"', "/", " ", "+", "\\", "&"))
  .map(([word, mark]) => `sk-${word}${mark}${word.slice(0, 3)}`);

/**
 * Where the person's file holds the secret: nowhere, at an unknown key, or under a declared key.
 * A scalar written at a declared key is the person's value, which S5's message shows, so it is not
 * placed there.
 */
const placed = (word: string) => {
  const s = JSON.stringify(word);
  return fc.constantFrom(
    "[instance]\nport = 18800\n",
    `[instance]\ntoken = ${s}\n`,
    `[instance]\nport = 18800\ntoken = ${s}\n`,
    `token = ${s}\n`,
    `[instance.port]\nkey = ${s}\n`,
    `[instance]\nport = { key = ${s} }\n`,
    `[instance]\nport = [${s}]\n`,
  );
};

describe("L8 [secrets], unrelated environment values and refused file values never reach output or telemetry", () => {
  it("stdout, stderr, the formatted failure, log fields and spans hold no form of a secret", async () => {
    await fc.assert(
      fc.asyncProperty(
        secret.chain((word) => fc.tuple(fc.constant(word), placed(word))),
        fc.subarray(
          ["GITHUB_TOKEN", "FABRIKA_TOKEN", "FABRIKA_INSTANCE", "FABRIKA_INSTANCE_TOKEN", "CLOUDFLARE_API_TOKEN"],
          {
            minLength: 1,
          },
        ),
        fc.option(port, { nil: undefined }),
        fc.boolean(),
        async ([word, text], fields, envPort, all) => {
          const env: Record<string, string> = {
            HOME,
            ...Object.fromEntries(fields.map((f) => [f, word])),
            ...(envPort === undefined ? {} : { [Declarations.port.env]: String(envPort) }),
          };
          const ran = await run({ args: all ? ["--all"] : [], env, person: { _tag: "text", text } });
          const outputs = [
            ...ran.stdout,
            ...ran.stderr,
            ...ran.logs,
            ran.spans,
            Exit.isFailure(ran.exit) ? Cause.pretty(ran.exit.cause) : "",
            String(ran.exit),
          ];

          for (const output of outputs) {
            for (const form of forms(word)) {
              expect(output, output).not.toContain(form);
            }
          }
        },
      ),
      check,
    );
  });
});
