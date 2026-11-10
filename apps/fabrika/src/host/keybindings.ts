import {createHash} from "node:crypto";
import {
	Deferred,
	Effect,
	FileSystem,
	Path,
	type PlatformError,
	Result,
	Schema,
	Semaphore,
	Stream,
	SubscriptionRef,
} from "effect";
import {
	decodeKeys,
	defaults,
	File,
	type Key,
	patchKeys,
	spell,
	writtenKeys,
} from "../desk/keymap.ts";
import {
	Edit,
	type KeybindingManager as Manager,
	KeybindingService as ManagerService,
	type Snapshot,
} from "../keys/program.ts";
import {saidOf, settingsFile} from "./settings.ts";

export {Edit};
export type {Snapshot};

class Refused extends Schema.TaggedError<Refused>()("KeybindingRefused", {why: Schema.String}) {
	get message() {
		return this.why;
	}
}

interface Source {
	readonly how: "pressed";
	readonly window: string;
	readonly said: number;
}

type Value = string | readonly string[] | null;

const version = (text: string | null) =>
	createHash("sha256")
		.update(text === null ? "missing" : `file:${text}`)
		.digest("hex");

const spelling = (key: Key) => `${key._tag === "after_prefix" ? "<prefix>" : ""}${spell(key.key)}`;
const same = (a: Key, b: Key) => a._tag === b._tag && a.key === b.key;

/**
 * How many changes each snapshot carries to the pages. The window shows the newest and names keys
 * that moved; Undo is held here, apart from this list. Every change is still logged in full as
 * `keybindings_changed`, so the cap only bounds what each page is sent, not what is recorded.
 */
const CHANGES_SENT = 20;

/** Only a save reads and writes here: either failing is a failed save. */
const failed = (error: PlatformError.PlatformError) =>
	new Refused({why: `save of keybindings.toml failed: ${saidOf(error)}`});

export type KeybindingManager = Manager;

export const KeybindingManager = Object.assign(ManagerService, {
	make: (options: {readonly folder: string; readonly mac: boolean; readonly by: string}) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const file = path.join(options.folder, "keybindings.toml");
			const one = (yield* Semaphore.make(1)).withPermits(1);
			const state = yield* SubscriptionRef.make<Snapshot>({
				version: version(null),
				keys: defaults,
				changes: [],
			});
			let bytes: string | null = null;
			let initial = true;
			let undo: {version: string; rows: ReadonlyMap<string, Value>} | null = null;
			const ready = yield* Deferred.make<void>();
			const read = Effect.suspend(() => fs.readFileString(file)).pipe(
				Effect.catch((error) =>
					error.reason._tag === "NotFound" ? Effect.succeed(null) : Effect.fail(failed(error)),
				),
			);
			const modified = fs.stat(file).pipe(
				Effect.map((stat) => (stat.mtime._tag === "Some" ? stat.mtime.value.getTime() : null)),
				Effect.orElseSucceed(() => null),
			);
			const refuse = (why: string, line = 1) =>
				SubscriptionRef.update(state, (s) => ({
					...s,
					keys: {...s.keys, file: File.cases.refused.make({line, why})},
				}));
			const observe = (
				text: string | null,
				from: Source | null,
				displaced: Snapshot["changes"][number]["displaced"] = [],
			) =>
				Effect.gen(function* () {
					const current = yield* SubscriptionRef.get(state);
					const digest = version(text);

					if (!initial && digest === current.version) {
						if (current.keys.file._tag !== "refused") {
							return current;
						}

						const recovered = {
							...current,
							keys: {
								...current.keys,
								file: text === null ? File.cases.none.make({}) : File.cases.read.make({}),
							},
						};
						yield* SubscriptionRef.set(state, recovered);
						return recovered;
					}

					const decoded = text === null ? Result.succeed(defaults) : decodeKeys(text, options.mac);

					if (Result.isFailure(decoded)) {
						yield* refuse(decoded.failure.why, decoded.failure.line);
						initial = false;
						return yield* SubscriptionRef.get(state);
					}

					const keys = decoded.success;
					const record: Snapshot["changes"][number] = {
						by: from === null ? null : options.by,
						at: yield* Effect.clockWith((clock) => Effect.succeed(clock.currentTimeMillisUnsafe())),
						said: from?.said ?? null,
						window: from?.window ?? null,
						how: from?.how ?? "file",
						modified: from === null ? yield* modified : null,
						before: current.keys,
						after: keys,
						displaced,
						version: digest,
					};
					const snapshot: Snapshot = {
						version: digest,
						keys,
						changes: initial ? [] : [...current.changes, record].slice(-CHANGES_SENT),
					};

					if (!initial) {
						yield* Effect.logInfo("keybindings_changed").pipe(
							Effect.annotateLogs({change: record}),
						);
					}

					initial = false;
					bytes = text;
					yield* SubscriptionRef.set(state, snapshot);
					return snapshot;
				});
			yield* settingsFile(options.folder, "keybindings.toml", (text) => Result.succeed(text)).pipe(
				Stream.runForEach((answer) =>
					one(
						Effect.gen(function* () {
							if (answer._tag === "refused") {
								yield* refuse(answer.why, answer.line);
							} else {
								yield* observe(answer._tag === "none" ? null : answer.value, null);
							}

							yield* Deferred.succeed(ready, undefined);
						}),
					),
				),
				Effect.forkScoped,
			);
			yield* Deferred.await(ready);
			const edit = (request: typeof Edit.Type, from: Source) =>
				one(
					Effect.gen(function* () {
						const latest = yield* read;
						const checked =
							latest === null ? Result.succeed(defaults) : decodeKeys(latest, options.mac);

						if (Result.isFailure(checked)) {
							return yield* new Refused({
								why: `line ${checked.failure.line}: ${checked.failure.why}`,
							});
						}

						if (latest !== bytes) {
							yield* observe(latest, null);
						}

						const before = yield* SubscriptionRef.get(state);
						const text = latest ?? "";
						const values = writtenKeys(text);
						const changes = new Map<string, Value>();
						const displaced: {does: (typeof checked.success.rows)[number]["does"]; key: Key}[] = [];

						switch (request._tag) {
							case "prefix":
								changes.set("prefix", request.key);
								break;
							case "ignore":
								changes.set("ignore", request.keys);
								break;
							case "reset":
								changes.set(request.does, null);
								break;
							case "undo":
								if (
									undo === null ||
									request.version !== undo.version ||
									request.version !== before.version
								) {
									return yield* new Refused({
										why: "The file changed to a newer version. Undo is no longer available.",
									});
								}

								for (const [word, value] of undo.rows) {
									changes.set(word, value);
								}

								break;
							case "bind": {
								// Decode the requested row apart so existing user claims can be removed before checking the result.
								const candidate = decodeKeys(
									`${request.does} = ${JSON.stringify(request.keys)}`,
									options.mac,
								);

								if (Result.isFailure(candidate)) {
									return yield* new Refused({why: candidate.failure.why});
								}

								const claimed =
									candidate.success.rows.find((row) => row.does === request.does)?.keys ?? [];

								for (const row of checked.success.rows) {
									if (row.does === request.does) {
										continue;
									}

									const lost = row.keys.filter((key) => claimed.some((take) => same(key, take)));

									for (const key of lost) {
										displaced.push({does: row.does, key});
									}

									if (lost.length > 0 && row.source === "yours") {
										changes.set(
											row.does,
											row.keys.filter((key) => !lost.some((take) => same(key, take))).map(spelling),
										);
									}
								}

								changes.set(request.does, request.keys);
								break;
							}
						}

						const saved = patchKeys(text, changes);
						const decoded = decodeKeys(saved, options.mac);

						if (Result.isFailure(decoded)) {
							return yield* new Refused({
								why: `line ${decoded.failure.line}: ${decoded.failure.why}`,
							});
						}

						const restore = new Map<string, Value>(
							[...changes.keys()].map((word) => [word, values.get(word) ?? null]),
						);
						// Write beside the real file, so a symlinked keybindings.toml stays a link and the
						// rename stays on one disk, and keep the mode it already has.
						const real = yield* fs.realPath(file).pipe(Effect.orElseSucceed(() => file));
						const mode = yield* fs.stat(real).pipe(
							Effect.map((stat) => stat.mode & 0o7777),
							Effect.orElseSucceed(() => 0o600),
						);
						const temporary = path.join(
							path.dirname(real),
							`.keybindings-${crypto.randomUUID()}.tmp`,
						);
						yield* fs
							.writeFileString(temporary, saved, {mode})
							.pipe(
								Effect.andThen(fs.chmod(temporary, mode)),
								Effect.andThen(fs.rename(temporary, real)),
								Effect.ensuring(fs.remove(temporary).pipe(Effect.ignore)),
								Effect.mapError(failed),
							);
						const applied = yield* observe(saved, from, displaced);
						undo = request._tag === "undo" ? null : {version: applied.version, rows: restore};
						return applied;
					}),
				);
			return ManagerService.of({
				current: SubscriptionRef.get(state),
				changes: SubscriptionRef.changes(state),
				edit,
			});
		}),
});
