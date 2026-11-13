/**
 * One Rolldown bundle as an Effect, and the program bundles built on it.
 *
 * @stability unstable
 */
import { Cause, Effect, Exit, Path } from "effect";
import effectPackage from "effect/package.json" with { type: "json" };
import {
  rolldown,
  VERSION,
  type InputOption,
  type LogLevel,
  type LogOrStringHandler,
  type Plugin,
  type RolldownLog,
  type RolldownOutput,
} from "rolldown";
import { BuildError, hash } from "../../runtime/Built.ts";
import type { ProgramSource } from "../../runtime/Execution.ts";

export { BuildError, hash } from "../../runtime/Built.ts";

/**
 * Which bundle of a build this is. It is recorded on the bundle's span, with no path or content,
 * and it decides which imports the bundle leaves external.
 *
 * @stability unstable
 * @category models
 */
export type Phase = "program" | "window" | "tab" | "brain";

type Options = {
  readonly phase?: Phase;
  /** Where module ids are made relative, so the bytes never name the checkout. */
  readonly cwd?: string;
  /** Let the bundle emit secondary chunks (windows); a program or a brain stays one module. */
  readonly split?: boolean;
  readonly define?: Readonly<Record<string, string>>;
  readonly minify?: boolean;
};

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

/** The bytes a bundle emitted, chunks and assets alike. */
const emitted = (output: RolldownOutput) =>
  output.output.reduce(
    (total, item) =>
      total +
      (item.type === "chunk"
        ? bytes(item.code)
        : typeof item.source === "string"
          ? bytes(item.source)
          : item.source.byteLength),
    0,
  );

/**
 * Runs one Rolldown bundle and answers its output: ES modules for the browser platform, generated
 * in memory and never written to disk.
 *
 * **Details**
 *
 * `options.phase` decides which imports stay external: `cloudflare:workers` by default, that and
 * every `node:` module for a brain, and none for a tab. The span records the phase, the Rolldown
 * and Effect versions that ran, and how many files and bytes came out. A failure is a `BuildError`
 * with `reason: "bundle"`.
 *
 * @stability unstable
 * @category constructors
 */
export const bundle = Effect.fn("build.bundle")(function* (
  input: InputOption,
  plugins: Array<Plugin>,
  options: Options = {},
) {
  // The installed tools' own versions, so a build report says what really ran.
  yield* Effect.annotateCurrentSpan({
    phase: options.phase ?? "bundle",
    "rolldown.version": VERSION,
    "effect.version": effectPackage.version,
  });
  const fail = (error: unknown) => new BuildError({ reason: "bundle", message: String(error), cause: error });
  const config = {
    input,
    plugins,
    // Rolldown notes each "use client" it drops; a bundle here has no server half.
    onLog: (level: LogLevel, log: RolldownLog, handler: LogOrStringHandler) => {
      if (log.code !== "MODULE_LEVEL_DIRECTIVE") {
        handler(level, log);
      }
    },
    platform: "browser" as const,
    // A tab names no platform module, so nothing is external there: its build refuses one.
    external:
      options.phase === "brain"
        ? ["cloudflare:workers", /^node:/]
        : options.phase === "tab"
          ? []
          : ["cloudflare:workers"],
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.define === undefined ? {} : { transform: { define: { ...options.define } } }),
  };
  const output = { format: "esm" as const, codeSplitting: options.split === true, minify: options.minify === true };
  const generate = Effect.acquireUseRelease(
    // oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown's build API returns a Promise
    Effect.tryPromise({ try: () => rolldown(config), catch: fail }),
    // oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown generates through a Promise
    (b) => Effect.tryPromise({ try: () => b.generate(output), catch: fail }),
    // oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown closes through a Promise
    (b) => Effect.promise(() => b.close()),
  );
  return yield* generate.pipe(
    Effect.onExit((exit) =>
      Effect.annotateCurrentSpan(
        Exit.isSuccess(exit)
          ? {
              outcome: "success",
              "output.files": exit.value.output.length,
              "output.bytes": emitted(exit.value),
            }
          : {
              outcome: "failure",
              "error.type": Cause.hasInterruptsOnly(exit.cause) ? "interrupted" : "BuildError",
            },
      ),
    ),
  );
});

/**
 * Bundles each selected program as one sealed Worker Loader module: its declaration wrapped in
 * libfabrika's program box. It answers, by program name, each module's source with the SHA-256 of
 * that source.
 *
 * @stability unstable
 * @category constructors
 */
export const bundlePrograms = Effect.fn("build.bundlePrograms")(function* (options: {
  /** The folder the generated entry sits in, so package names resolve from there. */
  readonly root: string;
  readonly cwd?: string;
  readonly programs: Readonly<Record<string, { readonly module: string; readonly name: string }>>;
  readonly plugins: Array<Plugin>;
}) {
  const path = yield* Path.Path;
  const generated = path.join(options.root, "program.generated.ts");
  const programs: Record<string, ProgramSource> = {};

  for (const [name, entry] of Object.entries(options.programs)) {
    const code = `import {programBox} from "@kampus/libfabrika/box"; import {${entry.name} as program} from ${JSON.stringify(entry.module)}; export default programBox(program, ${JSON.stringify(name)});`;
    const output = yield* bundle(
      "fabrika:program",
      [
        ...options.plugins,
        {
          name: "fabrika-program",
          resolveId(id) {
            if (id === "fabrika:program") {
              return generated;
            }
          },
          load(id) {
            if (id === generated) {
              return code;
            }
          },
        },
      ],
      { phase: "program", ...(options.cwd === undefined ? {} : { cwd: options.cwd }) },
    );
    const source = output.output
      .filter((o) => o.type === "chunk")
      .map((o) => o.code)
      .join("\n");
    programs[name] = { hash: yield* hash(source), source };
  }

  return programs;
});
