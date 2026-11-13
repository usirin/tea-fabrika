// pin.ts: a running lane keeps one version of its scripts from start to end (ticket 835). Today's
// lead tooling, run on our own laptop; it is not product.
//
// A lane is one long chain process. It holds the chain and drive code in memory, but each step it
// runs the lead's other scripts from disk: the box, step-commit and bot-push scripts and
// more. A pull of main while it ran mixed the old code in memory with the new scripts on disk, and
// the lanes p41s2 and p42s1 died on ENOENT when one pull moved the boxes (2026-11-11).
//
// The known way is a release folder: Capistrano deploys each version into `releases/<stamp>` and a
// process started there keeps it, whatever is deployed after; a Jenkins pipeline resolves its
// shared library to one commit when the build starts and logs it; a CI runner checks the repo out
// at the job's commit for that job alone. So a lane, at start:
//
//   1. resolves the main checkout's commit                   git rev-parse HEAD
//   2. writes `.agents/` and `package.json` at that commit   git archive | tar, into
//      into its own folder                                   BOXES/pins/<lane>.<pid> (pinFolder)
//   3. links the main checkout's node_modules there          the scripts' imports resolve
//   4. runs the chain again from that folder, FABRIKA_PIN    every import.meta.dirname, and so
//      naming the commit and the folder                      every script it spawns, is the pin's
//   5. removes the folder when the lane ends                 the scope's release (0061)
//
// The pinned chain writes the commit into its chain record (`scripts`) and prints it, with the
// commit its last process ran on, so a restart is a new choice anyone can see. A lane killed with
// SIGKILL runs no release: the box cleanup removes a pin no running process names once it is 2 h old
// (`decidePin`; 0101's timer runs it).
//
// What the pin does not hold: files the scripts read through MAIN (the exam signer
// `next/apps/fabrika/src/exam/commits.ts`, `exam-paths.json`, `local.env`'s settings) and the
// packages in node_modules. Uncommitted edits under `.agents/` in the main checkout are not in the
// pin either; the launch prints one line when there are some.

import { Console, Effect, FileSystem, Option, Path, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";

/** The environment variable the pinned chain reads: its pin, as JSON. */
export const PIN_ENV = "FABRIKA_PIN";

/** What a pin holds of the main checkout at its commit. */
export const ARCHIVED = [".agents", "package.json"] as const;

/** One lane's pin: the commit its scripts come from, and the folder they run from. */
export const Pinned = Schema.Struct({
  commit: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
  folder: Schema.String,
});
export type Pinned = typeof Pinned.Type;

const PinnedText = Schema.fromJsonString(Pinned);

/** Where this process's scripts come from: the checkout it was started in, or a pin. */
export const PinState = Schema.TaggedUnion({
  unpinned: {},
  pinned: { pin: Pinned },
  malformed: { value: Schema.String },
});
export type PinState = typeof PinState.Type;

/** What FABRIKA_PIN's value says. A value that does not parse is never read as no pin. */
export const pinState = (value: string | undefined): PinState =>
  value === undefined
    ? PinState.cases.unpinned.make({})
    : Option.match(Schema.decodeUnknownOption(PinnedText)(value), {
        onNone: () => PinState.cases.malformed.make({ value }),
        onSome: (pin) => PinState.cases.pinned.make({ pin }),
      });

/** FABRIKA_PIN's value for a pin. */
export const pinText = (pin: Pinned): string => Schema.encodeSync(PinnedText)(pin);

/** A lead script's path inside a pin. */
export const pinnedScript = (folder: string, script: string): string =>
  `${folder}/.agents/skills/lead/scripts/${script}`;

const short = (commit: string) => commit.slice(0, 12);

/** The line the pinned chain prints at start: its commit, and what its lane's last process ran on. */
export const pinLine = (before: Pinned | undefined, now: Pinned): string =>
  `scripts pinned at ${short(now.commit)} in ${now.folder}; ${
    before === undefined
      ? "the lane's first pinned process"
      : before.commit === now.commit
        ? "the same commit as the lane's last process"
        : `the lane's last process ran on ${short(before.commit)}`
  }`;

// ---------------------------------------------------------------- the world

/** A pin that could not be made, or a pinned run that could not start. */
export class PinFailed extends Schema.TaggedError<PinFailed>()("PinFailed", { reason: Schema.String }) {}

const ran = Effect.fnUntraced(function* (command: ChildProcess.Command) {
  const handle = yield* command;
  const [output, code] = yield* Effect.all([Stream.mkString(Stream.decodeText(handle.all)), handle.exitCode], {
    concurrency: 2,
  });
  return { code: Number(code), output: output.trim() };
}, Effect.scoped);

const git = (main: string, args: ReadonlyArray<string>) => ran(ChildProcess.make("git", ["-C", main, ...args]));

const failed = (reason: string) => () => new PinFailed({ reason });

/**
 * The lane's pin, made from the main checkout's commit and removed when the scope closes. Fails
 * when the commit cannot be read or `script`, the lead script the lane runs, is not there after
 * the copy.
 */
export const acquire = Effect.fn("pin.acquire")(function* (o: {
  readonly main: string;
  readonly folder: string;
  readonly script: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const head = yield* git(o.main, ["rev-parse", "--verify", "HEAD^{commit}"]).pipe(
    Effect.mapError(failed("git could not start")),
  );

  if (head.code !== 0) {
    return yield* new PinFailed({ reason: `the main checkout's commit cannot be read: ${head.output}` });
  }

  const dirty = yield* git(o.main, ["status", "--porcelain", "--", ...ARCHIVED]).pipe(
    Effect.mapError(failed("git could not start")),
  );

  if (dirty.output !== "") {
    yield* Console.error(`pin: uncommitted changes under ${ARCHIVED.join(" and ")} are not in the pin`);
  }

  const folder = o.folder;
  yield* Effect.acquireRelease(
    fs.makeDirectory(folder, { recursive: true }).pipe(Effect.mapError(failed(`${folder} cannot be made`))),
    () => fs.remove(folder, { recursive: true, force: true }).pipe(Effect.ignore),
  );
  const copied = yield* ran(
    ChildProcess.make("git", ["-C", o.main, "archive", "--format=tar", head.output, "--", ...ARCHIVED]).pipe(
      ChildProcess.pipeTo(ChildProcess.make("tar", ["-x", "-f", "-", "-C", folder])),
    ),
  ).pipe(Effect.mapError(failed("git archive or tar could not start")));
  const script = pinnedScript(folder, o.script);

  if (copied.code !== 0 || !(yield* fs.exists(script).pipe(Effect.orElseSucceed(() => false)))) {
    return yield* new PinFailed({ reason: `the scripts at ${short(head.output)} were not copied: ${copied.output}` });
  }

  yield* fs
    .symlink(path.join(o.main, "node_modules"), path.join(folder, "node_modules"))
    .pipe(Effect.mapError(failed(`node_modules cannot be linked into ${folder}`)));
  return Pinned.make({ commit: head.output, folder });
});

/**
 * Run the lead script `script` from its pin with these arguments, the same stdio and working
 * folder, and answer its exit code. MAIN and BOXES go with it: the pin is no git checkout, so the lead's env script cannot
 * find the main checkout from the pin's own folder.
 */
export const runPinned = Effect.fn("pin.runPinned")(
  function* (
    pin: Pinned,
    env: { readonly MAIN: string; readonly BOXES: string },
    script: string,
    args: ReadonlyArray<string>,
  ) {
    const handle = yield* ChildProcess.make(process.execPath, [pinnedScript(pin.folder, script), ...args], {
      env: { [PIN_ENV]: pinText(pin), MAIN: env.MAIN, BOXES: env.BOXES },
      extendEnv: true,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return Number(yield* handle.exitCode);
  },
  Effect.scoped,
  (effect) => Effect.mapError(effect, failed("the pinned script could not start")),
);
