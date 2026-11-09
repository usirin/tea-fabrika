import {join} from "node:path";
import {
	Data,
	Deferred,
	Effect,
	Exit,
	FileSystem,
	Path,
	type PlatformError,
	Result,
	Schedule,
	Stream,
} from "effect";
import type {Launch} from "../launch.ts";

// The one reader of the person's settings folder: keybindings.toml now (desk/keymap.ts), and
// fabrika.toml's theme later, by the same rule (plan for ticket 174, "one reader of ~/.fabrika/").
// Today's version. Effect's FileSystem and Path only, so a test runs it on a temp folder.
//
//   settingsFile(folder, "keybindings.toml", decode)
//     no file                                   {_tag: "none"}
//     a file that decodes                       {_tag: "read", value}
//     a file that does not                      {_tag: "refused", line, why}
//     a save, in place or by a rename over it   the next answer, with no restart
//
// The folder hears new files; the file hears writes. Its watch is replaced after a rename or
// deletion, since a watch on the old file would stay there. Each file is read apart, so a
// bad fabrika.toml never touches the keys, and the other way round. An answer is said once: a
// save that leaves the text as it was says nothing. A page never reads a file; the host sends
// each value on (a browser is always a client).

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
	read: {readonly value: A};
	refused: {readonly line: number; readonly why: string};
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

/** How long a burst of events from one save is waited out, in ms: an editor's write and rename are one save. */
const SETTLE_MS = 50;

/**
 * Every answer for the file `name` in `folder`: one as the watch starts, then one each time a save
 * changes its text. The folder is made if it is missing, so a file put there later is heard; when it
 * cannot be made, or the watch fails, the answer stays as it was last said.
 */
export const settingsFile = <A>(
	folder: string,
	name: string,
	decode: (text: string) => Result.Result<A, {readonly line: number; readonly why: string}>,
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
						(error.cause instanceof Error &&
							"code" in error.cause &&
							error.cause.code === "ENOTDIR")
							? Effect.succeed(null)
							: Effect.succeed(
									Setting.refused({line: 1, why: `it could not be read: ${saidOf(error)}`}),
								),
					),
				);
			const answer = (said: string | null | Setting<never>): Setting<A> => {
				if (said === null) return Setting.none();
				if (typeof said !== "string") return said;
				const read = decode(said);
				return Result.isSuccess(read)
					? Setting.read({value: read.success})
					: Setting.refused({line: read.failure.line, why: read.failure.why});
			};
			const made = yield* Effect.exit(fs.makeDirectory(folder, {recursive: true}));
			if (Exit.isFailure(made)) {
				yield* Effect.logWarning("fabrika host: the settings folder could not be created");
				return Stream.fromEffect(Effect.map(text, answer));
			}
			// NodeFileSystem 4.1.2 uses fs.watch. macOS folder watches use FSEvents, which can
			// coalesce writes; file watches use kqueue. A folder event is not a receipt for each
			// write after a rename or deletion. Keep a file watch too, bound before rereading.
			// https://github.com/libuv/libuv/blob/v1.52.1/src/unix/kqueue.c#L531-L558
			// https://github.com/apple-oss-distributions/xnu/blob/main/bsd/vfs/vfs_fsevents.c#L398-L461
			const watch = (target: string): Stream.Stream<void> =>
				Stream.suspend(() => {
					let replaced = false;
					return Stream.unwrap(
						Effect.gen(function* () {
							replaced = false;
							const ready = yield* Deferred.make<boolean>();
							const saves = fs
								.watch(target, {onReady: () => Deferred.doneUnsafe(ready, Effect.succeed(true))})
								.pipe(
									Stream.tap((event) =>
										Effect.sync(() => {
											replaced ||= event._tag !== "Update";
										}),
									),
									Stream.debounce(`${SETTLE_MS} millis`),
									Stream.takeUntil(() => replaced),
									Stream.map(() => undefined),
									// A failed watch still releases the first read, then ends. A missing file
									// is bound again only when the folder hears a change, never by polling.
									Stream.catchCause(() =>
										Stream.fromEffect(
											Effect.gen(function* () {
												replaced = false;
												yield* Deferred.succeed(ready, false);
												if (target === folder)
													yield* Effect.logWarning("fabrika host: the settings watch ended");
											}),
										).pipe(Stream.drain),
									),
								);
							const initial = Stream.unwrap(
								Deferred.await(ready).pipe(
									Effect.map((started) =>
										started && target === folder
											? Stream.succeed(undefined).pipe(
													// fs.watch returns before macOS starts its folder stream. Close
													// that gap after every binding, including after a replacement.
													Stream.concat(Stream.fromEffect(Effect.sleep(`${SETTLE_MS} millis`))),
												)
											: Stream.succeed(undefined),
									),
								),
							);
							return Stream.merge(initial, saves);
						}),
					).pipe(
						// Closing a watch releases its native state. A structural event rebinds it;
						// an idle, missing or failed watch never starts another iteration.
						Stream.repeat(Schedule.forever.pipe(Schedule.while(() => replaced))),
					);
				});
			return watch(folder).pipe(
				// A folder event may be the only notice of replacement. Cancel the old file
				// watch, bind the new one, then read, including any save made during the handoff.
				Stream.switchMap(() => watch(file)),
				Stream.mapEffect(() => text),
				Stream.changesWith((a, b) => a === b),
				Stream.map(answer),
			);
		}),
	);
