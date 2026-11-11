import { join } from "node:path";
import {
  Clock,
  Data,
  Duration,
  Effect,
  Equal,
  Exit,
  FileSystem,
  Option,
  Path,
  type PlatformError,
  Queue,
  Ref,
  Result,
  Stream,
} from "effect";
import type { Launch } from "../launch.ts";

// The one reader of the person's settings folder: keybindings.toml now (desk/keymap.ts), and
// fabrika.toml's theme later, by the same rule (plan for ticket 174, "one reader of ~/.fabrika/").
// Today's version. Effect's FileSystem and Path only, so a test runs it on a temp folder.
//
//   settingsSaves(folder, "keybindings.toml", decode), one answer for each save burst
//     no file                                   {_tag: "none"}
//     a file that decodes                       {_tag: "read", value}
//     a file that does not                      {_tag: "refused", line, why}
//     a save, in place or by a rename over it   the next answer, with no restart
//
// The folder is watched, not the file: an editor saves by writing a new file and renaming it
// over the old one, and a watch on the old file would end there. A one second poll also reads
// the file, so a save is heard even without an OS event. Both wait for the text to stay still
// for 50 ms; hints with unchanged text do not delay it. Any watch hint keeps its source "watch".
// Each file is read apart, so a bad fabrika.toml never touches the keys, and the other way round.
// An answer is said once for each burst of saves, the same text as before included: each save
// gives the file a new stamp (its mtime, size and inode), read with its text. A watch hint or a
// poll tick that finds the text and the stamp as they were says nothing, readable or not. A page
// never reads a file; the host sends each value on (a browser is always a client).

/**
 * What an OS failure means, in words. The error's own message names the full path, which is a
 * machine's and has no place on a screen or in a shot, so the file is named as the person knows
 * it, `keybindings.toml`, and the failure by its kind.
 */
const PLAIN: Readonly<Record<PlatformError.PlatformError["reason"]["_tag"], string>> = {
  AlreadyExists: "it already exists",
  BadArgument: "the request was not valid",
  BadResource: "it is not a file that can be read or written",
  Busy: "it is busy",
  InvalidData: "its contents are not valid",
  NotFound: "it was not found",
  PermissionDenied: "permission denied",
  TimedOut: "it timed out",
  UnexpectedEof: "it ended too early",
  Unknown: "the system did not say why",
  WouldBlock: "it would have to wait",
  WriteZero: "nothing was written",
};

export const saidOf = (error: PlatformError.PlatformError): string => PLAIN[error.reason._tag];

/** What came of a settings file: none, what it decoded to, or why not, with the line to look at. */
export type Setting<A> = Data.TaggedEnum<{
  none: Record<never, never>;
  read: { readonly value: A };
  refused: { readonly line: number; readonly why: string };
}>;

interface SettingOf extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: Setting<this["A"]>;
}

const Setting = Data.taggedEnum<SettingOf>();

/**
 * Which folder holds the settings (p11): `~/.fabrika` for the owner's start; the home itself for a
 * start on a home of its own (a test or an agent, `FABRIKA_HOME` set), so no test ever reads the
 * person's real file.
 */
export const settingsFolder = (launch: Launch, userHome: string): string =>
  launch.kind === "owner" ? join(userHome, ".fabrika") : launch.home;

/** How long the observed text must stay unchanged, in ms, including the closing read. */
const SETTLE_MS = 50;

/** How often the file itself is looked at, so a save is heard when the OS sends no event. */
const POLL = Duration.seconds(1);

/** How a save was heard: the OS watch told us, or the poll found it. */
type Heard = "watch" | "poll";

/**
 * What a read of the file found: its text (`said`) and its save stamp, or `null` when the file
 * has none to give (it is not there). The stamp tells two saves of the same text apart.
 */
interface Seen<A> {
  readonly said: A;
  readonly stamp: string | null;
}

/** Wait for unchanged text, moving the end only on a change and keeping any watch hint. */
const settle =
  <A>(read: Effect.Effect<Seen<A>>) =>
  (hints: Stream.Stream<Seen<A> & { readonly by: Heard }>) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const queue = yield* Stream.toQueue(
          hints.pipe(Stream.mapEffect((hint) => Effect.map(Clock.currentTimeMillis, (at) => ({ ...hint, at })))),
          { capacity: "unbounded" },
        );
        return Stream.fromEffectRepeat(
          Effect.gen(function* () {
            const first = yield* Queue.take(queue);
            let window = { said: first.said, stamp: first.stamp, by: first.by, end: first.at + SETTLE_MS };

            while (true) {
              const now = yield* Clock.currentTimeMillis;
              const hint = yield* Queue.take(queue).pipe(Effect.timeoutOption(Math.max(0, window.end - now)));

              if (Option.isSome(hint)) {
                window = {
                  said: hint.value.said,
                  stamp: hint.value.stamp,
                  by: window.by === "watch" || hint.value.by === "watch" ? "watch" : "poll",
                  end: Equal.equals(window.said, hint.value.said) ? window.end : hint.value.at + SETTLE_MS,
                };
              } else {
                const seen = yield* read;

                if (Equal.equals(window.said, seen.said)) {
                  return { ...seen, by: window.by };
                }

                window = { ...seen, by: window.by, end: (yield* Clock.currentTimeMillis) + SETTLE_MS };
              }
            }
          }),
        );
      }),
    );

type Decode<A> = (text: string) => Result.Result<A, { readonly line: number; readonly why: string }>;

/**
 * An answer for each burst of saves to the file `name` in `folder`, even when its text is what the
 * last answer said; one at once, with no wait for the watch. For a reader that also writes the file:
 * its own save moves what it holds, so a later save by another process that puts the text back is
 * news to it, though not to the watch (host/keybindings.ts). A save is told by the file's stamp,
 * read with its text; a watch hint or a poll tick that finds the text and the stamp as they were
 * last said, an unreadable file's included, says nothing. The folder is made if it is missing, so
 * a file put there later is heard; when it cannot be made, the answer stays as it was last said. If
 * the watch ends, the poll carries on.
 */
export const settingsSaves = <A>(
  folder: string,
  name: string,
  decode: Decode<A>,
): Stream.Stream<Setting<A>, never, FileSystem.FileSystem | Path.Path> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.join(folder, name);
      /** The file's text, or `null`: there is none, or it could not be read, which the log says. */
      const text = fs
        .readFileString(file)
        .pipe(
          Effect.catch((error) =>
            error.reason._tag === "NotFound" ||
            (error.cause instanceof Error && "code" in error.cause && error.cause.code === "ENOTDIR")
              ? Effect.succeed(null)
              : Effect.succeed(Setting.refused({ line: 1, why: `it could not be read: ${saidOf(error)}` })),
          ),
        );
      const answer = (said: string | null | Setting<never>): Setting<A> => {
        if (said === null) {
          return Setting.none();
        }

        if (typeof said !== "string") {
          return said;
        }

        const read = decode(said);
        return Result.isSuccess(read)
          ? Setting.read({ value: read.success })
          : Setting.refused({ line: read.failure.line, why: read.failure.why });
      };
      /** The file's save stamp: its mtime, size and inode, new on each write or rename. */
      const stamp = fs.stat(file).pipe(
        Effect.map(
          (info) =>
            `${Option.getOrUndefined(info.mtime)?.getTime() ?? ""}:${info.size}:${Option.getOrUndefined(info.ino) ?? ""}`,
        ),
        Effect.orElseSucceed(() => null),
      );
      const read = Effect.gen(function* () {
        const at = yield* stamp;
        return { said: yield* text, stamp: at };
      });
      const made = yield* Effect.exit(fs.makeDirectory(folder, { recursive: true }));

      if (Exit.isFailure(made)) {
        yield* Effect.logWarning(`fabrika host: no settings folder at ${folder}, so none is heard`);
        return Stream.fromEffect(Effect.map(text, answer));
      }

      const last = yield* Ref.make<Seen<string | null | Setting<never>> | undefined>(undefined);
      /** The text or the stamp differs from the last answer's: a save the last answer did not say. */
      const fresh = (now: Seen<string | null | Setting<never>>) =>
        Effect.map(
          Ref.get(last),
          (was) => was === undefined || !Equal.equals(now.said, was.said) || now.stamp !== was.stamp,
        );
      const say = (seen: Seen<string | null | Setting<never>>, by: Heard | "start") =>
        Ref.set(last, seen).pipe(
          Effect.andThen(Effect.logInfo("settings_heard").pipe(Effect.annotateLogs({ file: name, by }))),
          Effect.as(seen.said),
        );
      const heard = fs.watch(folder).pipe(
        Stream.filter((event) => path.basename(event.path) === name),
        Stream.mapEffect(() => Effect.map(read, (seen) => ({ ...seen, by: "watch" as const }))),
        Stream.concat(
          Stream.fromEffect(Effect.logWarning(`fabrika host: the watch on ${folder} ended`)).pipe(Stream.drain),
        ),
        Stream.catchCause((cause) =>
          Stream.fromEffect(Effect.logWarning(`fabrika host: the watch on ${folder} ended`, cause)).pipe(Stream.drain),
        ),
      );
      const polled = Stream.tick(POLL).pipe(
        Stream.mapEffect(() => read),
        Stream.filterEffect(fresh),
        Stream.map((seen) => ({ ...seen, by: "poll" as const })),
      );
      const saves = Stream.merge(heard, polled).pipe(settle(read), Stream.filterEffect(fresh));
      const first = Stream.fromEffect(Effect.map(read, (seen) => ({ ...seen, by: "start" as const })));
      return Stream.concat(first, saves).pipe(
        Stream.mapEffect(({ by, ...seen }) => say(seen, by)),
        Stream.map(answer),
      );
    }),
  );
