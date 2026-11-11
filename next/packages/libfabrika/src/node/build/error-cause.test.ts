// T695, next/. The build keeps the failure behind each BuildError (decision 0043 rule 12). Disk goes
// through Effect's FileSystem, which each law supplies with generated failures; Path is Effect's own.
// Audit sites: `build.ts:51`, the curried `fail(reason)` callback, through its callers at `:66` and
// `:71` (a selected package's manifest) and `:273` and `:283` (listed files and the Compiler ledger);
// `css.ts:24`, `:28`, `:32` and `:35`, the four branches of the stylesheet refusal, through both of
// its callers; `bundle.ts:47`, a Rolldown build that rejects.
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import * as fc from "fast-check";
import { BuildError, build } from "./build.ts";
import { bundle } from "./bundle.ts";
import { inlineStylesheet } from "./css.ts";

const SEED = 119120; // the shared seed (AGENTS.md), so a red run repeats
const RUNS = 100;

/** A property over generated input, each run an Effect on the real code. */
const law = <T>(name: string, input: fc.Arbitrary<T>, check: (input: T) => Effect.Effect<void, unknown, never>) =>
  it(name, () =>
    fc.assert(
      fc.asyncProperty(input, (value) => Effect.runPromise(check(value))),
      { seed: SEED, numRuns: RUNS },
    ),
  );

const failures: fc.Arbitrary<object> = fc.oneof(
  fc.string().map((message) => new Error(message)),
  fc.string().map((message) => new RangeError(message, { cause: { detail: message } })),
  fc.record({ code: fc.string(), detail: fc.jsonValue() }, { noNullPrototype: true }),
);

/** Disk with only these calls; every other call fails as missing, as Effect's noop file system does. */
const disk = (calls: Partial<FileSystem.FileSystem>) => Layer.merge(FileSystem.layerNoop(calls), Path.layer);

const ROOT = "/repo";

const options = (over: Partial<Parameters<typeof build>[0]> = {}): Parameters<typeof build>[0] => ({
  out: `${ROOT}/out`,
  root: ROOT,
  entry: `${ROOT}/next/apps/fabrika/brain.ts`,
  programs: [],
  files: [],
  ledger: [],
  chaos: false,
  ...over,
});

/** Each disk step `fail(reason)` serves before any bundle runs, and what goes wrong in it. */
type Step = "listed" | "ledger_read" | "ledger_decode" | "manifest_exists" | "manifest_read" | "manifest_decode";

const steps = fc.constantFrom<Step>(
  "listed",
  "ledger_read",
  "ledger_decode",
  "manifest_exists",
  "manifest_read",
  "manifest_decode",
);

/** The build options and disk that make `step` fail with `failure` (a damaged file for a decode). */
const world = (step: Step, failure: unknown, bad: string) => {
  const fails = <A>() => Effect.fail(failure as never) as Effect.Effect<A, never>;
  const damaged = Effect.succeed(bad);

  if (step === "listed") {
    return { options: options({ files: ["next/a.tsx"] }), disk: disk({ readFileString: () => fails() }) };
  }

  if (step === "ledger_read" || step === "ledger_decode") {
    const { ledger: _, ...rest } = options();
    return {
      options: rest,
      disk: disk({ readFileString: () => (step === "ledger_read" ? fails() : damaged) }),
    };
  }

  const program = [{ name: "counter", package: "counter-pkg", export: "program" }];
  return {
    options: options({ programs: program }),
    disk: disk({
      exists: () => (step === "manifest_exists" ? fails() : Effect.succeed(true)),
      readFileString: () => (step === "manifest_read" ? fails() : damaged),
    }),
  };
};

const stepReason = (step: Step) => (step.startsWith("manifest") ? "table" : "read");

describe("T695, the build's shared callback keeps what failed", () => {
  // C5, build.ts:51 through :66, :71, :273 and :283. Plant: `const fail = (reason) => () => ...`.
  law(
    "C5: whichever disk step fails, the build fails with that step's reason and the failure as its cause",
    fc.record({
      step: steps,
      failure: failures,
      // A decode meets JSON of the wrong shape, or text that is not JSON.
      bad: fc.oneof(
        fc.constant('{"exports": 7}'),
        fc.constant("[{}]"),
        fc.string().map((s) => `{${s}`),
      ),
    }),
    ({ step, failure, bad }) =>
      Effect.gen(function* () {
        const made = world(step, failure, bad);
        const error = yield* Effect.flip(Effect.provide(build(made.options), made.disk));
        expect(error).toBeInstanceOf(BuildError);
        expect(error.reason).toBe(stepReason(step));

        if (step.endsWith("_decode")) {
          expect(Schema.isSchemaError(error.cause), "the cause is the decoder's own failure").toBe(true);
        } else {
          expect(error.cause).toBe(failure);
        }
      }),
  );
});

describe("T695, a stylesheet refusal keeps what lightningcss or the disk said", () => {
  /** A failure whose message leads `refusal` down each of its four branches. */
  const messages = fc.oneof(
    fc.string().map((s) => `${s} unsupported @import condition`),
    fc.string().map((s) => `${s}BadString`),
    fc.string().map((s) => `${s}BadUrl`),
    fc.string().map((s) => `no such file ${s}`),
  );

  // C5, css.ts:24, :28, :32 and :35, through the realPath caller. Plant: drop `cause` in `refusal`.
  law(
    "C5: a stylesheet whose path cannot resolve keeps that failure as the cause, on every refusal branch",
    fc.record({ message: messages, file: fc.stringMatching(/^[a-z]{1,8}\.css$/) }),
    ({ message, file }) =>
      Effect.gen(function* () {
        const failure = new Error(message);
        const error = yield* Effect.flip(
          Effect.provide(inlineStylesheet(`${ROOT}/${file}`), disk({ realPath: () => Effect.fail(failure as never) })),
        );
        expect(error.reason).toBe("bundle");
        expect(error.cause).toBe(failure);
      }),
  );

  // C1, css.ts, the bundleAsync caller. Plant: drop `cause` in `refusal`.
  law(
    "C1: a stylesheet lightningcss refuses keeps lightningcss's own error as the cause",
    fc.record({
      open: fc.constantFrom('a { content: "', "a { background: url(", "@import "),
      tail: fc.stringMatching(/^[a-z]{0,6}$/),
    }),
    ({ open, tail }) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          Effect.provide(
            inlineStylesheet(`${ROOT}/a.css`),
            disk({ realPath: (p) => Effect.succeed(p), readFileString: () => Effect.succeed(`${open}${tail}\n`) }),
          ),
        );
        expect(error.reason).toBe("bundle");
        expect(error.cause, "the cause is what the bundler rejected with").toBeInstanceOf(Error);
      }),
  );
});

/** A Rolldown plugin whose `hook` throws `failure`, as a broken plugin does. */
const throwingPlugin = (hook: "buildStart" | "resolveId", failure: unknown) => ({
  name: "cause-probe",
  [hook]: () => {
    throw failure;
  },
});

describe("T695, a Rolldown build keeps what it rejected with", () => {
  // C1, bundle.ts:47. Plant: `new BuildError({ reason: "bundle", message: String(error) })`.
  law(
    "C1: a bundle whose plugin throws keeps Rolldown's rejection as the cause",
    fc.record({ failure: failures, hook: fc.constantFrom("buildStart", "resolveId") }),
    ({ failure, hook }) =>
      Effect.gen(function* () {
        const plugin = throwingPlugin(hook, failure);
        const error = yield* Effect.flip(bundle({ main: "virtual:cause-probe" }, [plugin], { phase: "program" }));
        expect(error.reason).toBe("bundle");
        expect(error.cause, "the cause is what Rolldown rejected with").toBeDefined();
      }),
  );
});
