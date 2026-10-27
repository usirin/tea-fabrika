// `fabrika move`: a laptop ledger's tickets into a new shared ledger, as a true copy. Every row
// keeps its stream, rev, kind, data, id and time, and who wrote it, mapped to the founder
// (packages/fabrika/src/host/move.ts). Stop, copy in `pos` order, check by hash, switch.
//
//   yield* move({home, from: "<home>/ledger.sqlite", to: "https://ledger.example.com/acme",
//                login: "alice", key: "~/.ssh/id_ed25519"})
//   // no host runs on the home; the file is read, read only; alice logs in, the founder
//   // every event under tracker/ticket goes in chunks, each one landing once
//   // the server hashes what it holds; the seal matches, and the ledger opens
//   // <home>/ledger.json now names the server; the file stays as it was, the archive
//
//   yield* dryRun({home, from, founder: "github:7"})
//   // the same plan and hash, and nothing written anywhere
//
// What moves is the tracker's shared work: every stream under `tracker/ticket` (each ticket's
// registered name and its inbox of facts, what the ticket view folds). What stays is a person's
// desk: the host's own names, leases, jobs, monitors, links, inboxes and dead letters, and the
// tsh job tables, which are files beside the ledger and never in it.
import {
	hashLines,
	linesOf,
	type Moved,
	type Plan,
	type Progress,
	planOf,
	type Seal,
	type SqlRow,
} from "@kampus/fabrika";
import {type DoorRefused, doorOf} from "@kampus/fabrika/http";
import {readOnlyRows} from "@kampus/fabrika/sqlite";
import {ROOT} from "@tea-fabrika/tracker";
import {Context, Duration, Effect, FileSystem, Layer, Option, Schedule, Schema} from "effect";
import {addressOf, type Connection, connectionOf, keepConnection, loginWith} from "./connection.ts";
import {alive} from "./lock.ts";
import {pathsOf, reach} from "./socket.ts";

/** The streams that move: the tracker's, every one under these. */
export const MOVED: readonly string[] = [ROOT];

/** How many events a chunk carries, unless the caller says. */
export const CHUNK = 200;

/** The move stopped before it was done, and why, in words. Run it again once that is fixed. */
export class MoveStopped extends Schema.TaggedError<MoveStopped>()("MoveStopped", {
	why: Schema.String,
}) {}

/** The connection to the server dropped. A chunk sent again lands once, so the move goes on. */
export class LinkDropped extends Schema.TaggedError<LinkDropped>()("LinkDropped", {
	why: Schema.String,
}) {}

// ---------------------------------------------------------------- the laptop's side

const UNDER = "(stream = ?1 OR (stream >= ?1 || '/' AND stream < ?1 || '0'))";

/** The old ledger's events under `MOVED`, in `pos` order, read with the file opened read only. */
export const readLaptop = (file: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		if (!(yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false))))
			return yield* new MoveStopped({why: `there is no ledger file at ${file}`});
		// The file is read as one nobody changes (`readOnlyRows`), which leaves out a `-wal`. A host
		// that quit cleanly leaves none; one with writes in it means a host runs or crashed.
		const wal = yield* fs.stat(`${file}-wal`).pipe(
			Effect.map((s) => Number(s.size)),
			Effect.orElseSucceed(() => 0),
		);
		if (wal > 0)
			return yield* new MoveStopped({
				why: `${file}-wal holds writes not yet in the file: a host runs, or did not quit cleanly. Start the app and quit it, then move`,
			});
		const rows = yield* Effect.try({
			try: () =>
				MOVED.flatMap((p) =>
					readOnlyRows(file, `SELECT * FROM events WHERE ${UNDER} ORDER BY pos`, p),
				),
			catch: (e) => new MoveStopped({why: `${file} does not read as a ledger: ${String(e)}`}),
		});
		return [...rows].sort((a, b) => Number(a.pos) - Number(b.pos)) as readonly SqlRow[];
	});

/** Why the home's host is running, or none: a live socket, or a start lock a live pid holds. */
export const hostRunning = (home: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const paths = yield* pathsOf(home);
		if ((yield* reach(paths.sock)) === "live")
			return Option.some(`a host answers on ${paths.sock}`);
		const text = yield* fs.readFileString(paths.lock).pipe(Effect.orElseSucceed(() => ""));
		const pid = Number.parseInt(text, 10);
		if (Number.isInteger(pid) && (yield* alive(pid)))
			return Option.some(`a host is starting, pid ${pid}`);
		return Option.none<string>();
	});

/** What a dry run prints, and what a move says it did: one line each. */
export const reportOf = (plan: Plan, hash: string): string[] => [
	`streams: ${plan.streams}`,
	`events: ${plan.events.length}`,
	...plan.writers.map((w) => `writer: ${w.from} -> ${w.to}: ${w.events} events`),
	...plan.unmappable.map((w) => `cannot map: ${w}`),
	...plan.refused.map((r) => `refused: ${r}`),
	`hash: ${hash}`,
];

/** The hash the seal checks, over the plan's events as the new ledger will hold them. */
const hashOf = (plan: Plan) =>
	Effect.tryPromise({
		try: () => hashLines(linesOf(plan)),
		catch: (e) => new MoveStopped({why: `the hash could not be taken: ${String(e)}`}),
	});

/** The plan and its hash, and nothing written anywhere. */
export const dryRun = (o: {
	readonly home: string;
	readonly from: string;
	readonly founder: string;
}) =>
	Effect.gen(function* () {
		const plan = planOf(yield* readLaptop(o.from), o.founder);
		const hash = yield* hashOf(plan);
		const running = yield* hostRunning(o.home);
		return {plan, hash, running};
	});

// ---------------------------------------------------------------- the server's side

/** The ledger a move goes into, as the founder logged in to it. */
export class MoveTarget extends Context.Service<
	MoveTarget,
	{
		/** The founder's id, as the door said at login: every mapped writer names it. */
		readonly founder: string;
		readonly progress: Effect.Effect<Progress, MoveStopped | LinkDropped>;
		readonly send: (events: readonly Moved[]) => Effect.Effect<Progress, MoveStopped | LinkDropped>;
		readonly seal: (seal: Seal) => Effect.Effect<Progress, MoveStopped | LinkDropped>;
	}
>()("@kampus/fabrika-app/MoveTarget") {}

/** The door's answer as the move reads it: no answer at all is a dropped link, else a stop. */
const stopOf = (d: DoorRefused) =>
	d.status === 0
		? new LinkDropped({why: d.why})
		: new MoveStopped({why: `the ledger refused (${d.status}): ${d.why}`});

const fromDoor = <A, R>(e: Effect.Effect<A, DoorRefused, R>) => e.pipe(Effect.mapError(stopOf));

/** The ledger at `c`, logged in to with its key: only its founder, as a person, may move into it. */
export const layerMoveTarget = (c: Connection) =>
	Layer.effect(
		MoveTarget,
		Effect.gen(function* () {
			const session = yield* loginWith(c).pipe(
				Effect.catchTags({
					KeyUnreadable: (e) => Effect.fail(new MoveStopped({why: `the key ${e.path}: ${e.why}`})),
					DoorRefused: (d) => Effect.fail(stopOf(d)),
				}),
			);
			if (session.who.kind !== "user")
				return yield* new MoveStopped({why: "a move is the founder's, as a person"});
			const door = doorOf({url: c.url, ledger: c.ledger});
			const {token} = session;
			return MoveTarget.of({
				founder: session.who.id,
				progress: fromDoor(door.moveProgress(token)),
				send: (events) => fromDoor(door.importChunk(token, events)),
				seal: (seal) => fromDoor(door.seal(token, seal)),
			});
		}),
	);

/**
 * Copy `rows` into the target and seal it. It goes on from where the server says the last run
 * stopped. Stops, with each name, on a writer it cannot map or a row the door would refuse.
 * A dropped link is tried again 3 times, from `pauseMs` (default 200 ms) and doubling: each call
 * lands once however often it is sent.
 */
export const copyInto = (
	rows: readonly SqlRow[],
	o: {readonly chunk?: number; readonly pauseMs?: number} = {},
) =>
	Effect.gen(function* () {
		const again = <A>(e: Effect.Effect<A, MoveStopped | LinkDropped>) =>
			e.pipe(
				Effect.retry({
					times: 3,
					schedule: Schedule.exponential(Duration.millis(o.pauseMs ?? 200)),
					while: (x) => x._tag === "LinkDropped",
				}),
			);
		const target = yield* MoveTarget;
		const plan = planOf(rows, target.founder);
		if (plan.unmappable.length > 0)
			return yield* new MoveStopped({
				why: `the move cannot map these writers, and does not guess: ${plan.unmappable.join(", ")}`,
			});
		if (plan.refused.length > 0)
			return yield* new MoveStopped({why: `the door would refuse: ${plan.refused.join("; ")}`});
		const hash = yield* hashOf(plan);
		const seal = {count: plan.events.length, hash};
		const at = yield* again(target.progress);
		if (at.state.kind === "open") {
			// A seal whose answer was lost: the same hash sealed it, so the move is done.
			if (at.state.by === "seal" && at.state.hash === hash) return {plan, hash, progress: at};
			return yield* new MoveStopped({
				why: `the ledger is open already, by ${at.state.by}: a move goes into a new ledger`,
			});
		}
		const size = Math.max(1, o.chunk ?? CHUNK);
		const rest = plan.events.filter((e) => e.from > at.last);
		for (let i = 0; i < rest.length; i += size) yield* again(target.send(rest.slice(i, i + size)));
		const progress = yield* again(target.seal(seal));
		return {plan, hash, progress};
	});

/**
 * The move: the host stopped, the file read read only, the copy, the seal, then the home's
 * connection. Run again after a stop or a dropped link, it goes on where it stopped.
 */
export const move = (o: {
	readonly home: string;
	readonly from: string;
	readonly to: string;
	readonly login: string;
	readonly key: string;
	readonly chunk?: number;
}) =>
	Effect.gen(function* () {
		const running = yield* hostRunning(o.home);
		if (Option.isSome(running))
			return yield* new MoveStopped({why: `${running.value}: stop it first, then move`});
		const {url, ledger} = yield* addressOf(o.to);
		const c: Connection = {url, ledger, login: o.login, key: o.key};
		const kept = yield* connectionOf(o.home);
		if (Option.isSome(kept) && (kept.value.url !== url || kept.value.ledger !== ledger))
			return yield* new MoveStopped({
				why: `this home is connected to ${kept.value.url}/${kept.value.ledger} already`,
			});
		const rows = yield* readLaptop(o.from);
		const done = yield* copyInto(rows, o.chunk === undefined ? {} : {chunk: o.chunk}).pipe(
			Effect.provide(layerMoveTarget(c)),
		);
		yield* keepConnection(o.home, c);
		return done;
	});
