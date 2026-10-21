// A watcher's monitors, as an Elm module like ./call.ts: a parent program keeps `Monitors` in its
// own state and hands its Msgs to `update` (docs/direction/elm-first.md).
//
//   watch "c:1"                     monitor c:1 under ref "c:1#1"
//   monitored c:1#1 on, incarnation 3
//   down c:1#1 crash, incarnation 3 outcome: down. Watch again under "c:1#2" (OTP: a monitor fires
//                                   once; a watcher that keeps watching monitors again)
//   monitored c:1#2 on, incarnation 6
//                                   outcome: gap 4..5. Those two ran and ended between the DOWN
//                                   and the new monitor: no monitor was on them
//
// OTP's `erlang:monitor(process, Name)`: a monitor is on the incarnation running when it is set.
// One that is set while the name is down answers `noproc` at once, and its DOWN `noproc` is in the
// inbox too, naming the incarnation it is down at. A `noproc` is not a death of its own.
//
// OTP has a gap here: between a DOWN and the next monitor, the name may be restarted and die
// again, and no monitor sees it. Experiment 99 met it: a poison message crashed a child every
// 10 ms, faster than the watcher could monitor again. The incarnation closes the gap. Incarnations
// only go up, one per restart, and a restart needs the one before it ended; so a monitor that lands
// on incarnation 6 after a DOWN of 3 proves 4 and 5 ended. That is the `gap` outcome: sequence-gap
// detection, as a feed reader finds lost messages by their numbers. Its reasons are not in it;
// they are in the target's registry stream (`exited` events) for a watcher that needs them. So
// every death of a watched name is reported once: as a `down`, or inside a `gap`.
//
// Pure: the clock comes in as Msgs. Refs are `<target>#<n>`, so a monitor sent again after a lost
// answer is the same monitor (the ledger keeps one per ref).
//
// 100: the re-arm backs off. 99 monitored a down name again every `retryMs`, and each try wrote a
// `noproc` DOWN into the watcher's own inbox: 117 of them in 1.5 s. Now the n-th miss in a row waits
// `min(maxRetryMs, retryMs * 2^(n-1))`, gRPC's connection backoff without the jitter (the reducer
// is pure; jitter would have to come in as data). A monitor that lands ends the row.
import {Duration, Effect, Schema, Stream} from "effect";
import type {DownMessage} from "./ledger.ts";

export interface MonitorSettings {
	/** The wait before the first retry of a monitor that found the name down, or did not land. */
	readonly retryMs: number;
	/** The longest wait between retries. Default `MAX_RETRY_MS`; equal to `retryMs`: 99's fixed retry. */
	readonly maxRetryMs?: number;
}

/** The default cap on the re-arm backoff. */
export const MAX_RETRY_MS = 1000;

/** The wait before the retry after `misses` misses in a row (from 1). */
export const retryDelayOf = (settings: MonitorSettings, misses: number) =>
	Math.min(settings.maxRetryMs ?? MAX_RETRY_MS, settings.retryMs * 2 ** Math.max(0, misses - 1));

export const Watch = Schema.Struct({
	target: Schema.String,
	/** The monitors set on it so far: the current ref is `<target>#<n>`. */
	n: Schema.Number,
	/** `asking`: the monitor is sent. `on`: it holds. `waiting`: monitor again at `due`. */
	status: Schema.Literals(["asking", "on", "waiting"]),
	/** The incarnation the monitor is on, while `on`. */
	incarnation: Schema.NullOr(Schema.Number),
	due: Schema.NullOr(Schema.Number),
	/**
	 * Every incarnation up to this one is known ended and reported. `null`: nothing seen yet (the
	 * first thing seen is where watching began, not a death).
	 */
	endedTo: Schema.NullOr(Schema.Number),
	/** 100: monitors in a row that did not land (`noproc`, or no answer): the backoff's count. */
	misses: Schema.Number,
});
export type Watch = typeof Watch.Type;

/** A parent program puts this Schema in its own state's Schema. */
export const Monitors = Schema.Struct({
	watches: Schema.Array(Watch),
	/** The inbox rev of the last DOWN read: one at or behind it was read before. */
	cursor: Schema.Number,
});
export type Monitors = typeof Monitors.Type;

export const noMonitors: Monitors = {watches: [], cursor: 0};

export const refOf = (w: Pick<Watch, "target" | "n">) => `${w.target}#${w.n}`;

export type MonitorMsg =
	/** Keep watching `target`: monitor it now, and again after each DOWN. */
	| {readonly type: "watch"; readonly target: string}
	/** The program started (or started again): send every monitor still asking again. */
	| {readonly type: "resume"}
	/** How `Self.monitor` answered, and when. `failed`: fenced or unreachable. */
	| {
			readonly type: "monitored";
			readonly ref: string;
			readonly how: "on" | "noproc" | "failed";
			readonly incarnation: number | null;
			readonly at: number;
	  }
	/** A DOWN from the inbox, at inbox rev `rev`. */
	| ({readonly type: "down"; readonly rev: number} & DownMessage)
	| {readonly type: "retry_due"; readonly ref: string};

export type MonitorCmd = {readonly type: "monitor"; readonly ref: string; readonly target: string};

export type MonitorOutcome =
	/**
	 * A death a monitor saw: the incarnation ended `normal`, `shutdown` or `crash`. `missed`: how
	 * many incarnations just before it ended unseen (0 nearly always).
	 */
	| ({readonly kind: "down"; readonly missed: number} & DownMessage)
	/** Incarnations `from`..`to` ended while no monitor was on them. */
	| {readonly kind: "gap"; readonly target: string; readonly from: number; readonly to: number}
	/** The name was down when the watcher looked, and that death was reported already. */
	| ({readonly kind: "noproc"} & DownMessage)
	| null;

export interface MonitorStepped {
	readonly monitors: Monitors;
	readonly cmds: readonly MonitorCmd[];
	readonly outcome: MonitorOutcome;
}

const ask = (w: Watch): MonitorCmd => ({type: "monitor", ref: refOf(w), target: w.target});
const asking = (w: Watch): Watch => ({
	...w,
	n: w.n + 1,
	status: "asking",
	incarnation: null,
	due: null,
});
const swap = (s: Monitors, from: Watch, to: Watch): Monitors => ({
	...s,
	watches: s.watches.map((x) => (x === from ? to : x)),
});
const byRef = (s: Monitors, ref: string) => s.watches.find((w) => refOf(w) === ref);

/** `w` learns every incarnation up to `to` has ended: the ones it had not reported, or none. */
const learn = (w: Watch, to: number): {readonly watch: Watch; readonly from: number | null} => {
	if (w.endedTo === null) return {watch: {...w, endedTo: to}, from: null};
	if (to <= w.endedTo) return {watch: w, from: null};
	return {watch: {...w, endedTo: to}, from: w.endedTo + 1};
};

export const update =
	(settings: MonitorSettings) =>
	(s: Monitors, m: MonitorMsg): MonitorStepped => {
		const none = (monitors: Monitors): MonitorStepped => ({monitors, cmds: [], outcome: null});
		switch (m.type) {
			case "watch": {
				if (s.watches.some((w) => w.target === m.target)) return none(s);
				const w = asking({
					target: m.target,
					n: 0,
					status: "asking",
					incarnation: null,
					due: null,
					endedTo: null,
					misses: 0,
				});
				return {monitors: {...s, watches: [...s.watches, w]}, cmds: [ask(w)], outcome: null};
			}
			case "resume":
				return {
					monitors: s,
					cmds: s.watches.filter((w) => w.status === "asking").map(ask),
					outcome: null,
				};
			case "monitored": {
				const w = byRef(s, m.ref);
				if (w === undefined || w.status !== "asking") return none(s);
				if (m.how !== "on" || m.incarnation === null) {
					const misses = w.misses + 1;
					const due = m.at + retryDelayOf(settings, misses);
					return none(swap(s, w, {...w, status: "waiting", due, misses}));
				}
				// On incarnation j: every one before it has ended.
				const {watch, from} = learn(w, m.incarnation - 1);
				const on = {...watch, status: "on" as const, incarnation: m.incarnation, misses: 0};
				const to = m.incarnation - 1;
				return {
					monitors: swap(s, w, on),
					cmds: [],
					outcome: from === null ? null : {kind: "gap", target: w.target, from, to},
				};
			}
			case "retry_due": {
				const w = byRef(s, m.ref);
				if (w === undefined || w.status !== "waiting") return none(s);
				const again = asking(w);
				return {monitors: swap(s, w, again), cmds: [ask(again)], outcome: null};
			}
			case "down": {
				if (m.rev <= s.cursor) return none(s);
				const read = {...s, cursor: m.rev};
				const {type: _, rev: __, ...down} = m;
				const w = read.watches.find((x) => x.target === m.target);
				if (w === undefined)
					return {
						monitors: read,
						cmds: [],
						outcome:
							m.reason === "noproc"
								? {kind: "noproc", ...down}
								: {kind: "down", missed: 0, ...down},
					};
				const {watch, from} = learn(w, m.incarnation);
				// Down at j: j and every one before it have ended. The monitor's own answer already
				// moved the watch on to a retry, so a `noproc` never moves it.
				if (m.reason === "noproc")
					return {
						monitors: swap(read, w, watch),
						cmds: [],
						outcome:
							from === null
								? {kind: "noproc", ...down}
								: {kind: "gap", target: w.target, from, to: m.incarnation},
					};
				// Two monitors may see one death (a monitor whose answer was lost, then its retry): the
				// second reports nothing, but still moves the watch on if it is the current one.
				const fresh = w.endedTo === null || from !== null;
				const outcome: MonitorOutcome = fresh
					? {kind: "down", missed: from === null ? 0 : m.incarnation - from, ...down}
					: null;
				// Only the current monitor moves the watch on; an older one's DOWN only reports.
				if (refOf(w) !== m.ref || w.status === "waiting")
					return {monitors: swap(read, w, watch), cmds: [], outcome};
				const again = asking(watch);
				return {monitors: swap(read, w, again), cmds: [ask(again)], outcome};
			}
		}
	};

/** The incarnations an outcome reports ended, as a range, or null: none. */
export const endedOf = (o: MonitorOutcome) =>
	o === null || o.kind === "noproc"
		? null
		: o.kind === "gap"
			? {target: o.target, from: o.from, to: o.to}
			: {target: o.target, from: o.incarnation - o.missed, to: o.incarnation};

/** One retry a waiting monitor is due at. */
export type Retry = {readonly ref: string; readonly at: number};

export const retriesOf = (s: Monitors): readonly Retry[] =>
	s.watches.flatMap((w) =>
		w.status === "waiting" && w.due !== null ? [{ref: refOf(w), at: w.due}] : [],
	);

/** The retries Sub's runner: one `retry_due` per retry, at its time. Times are absolute. */
export const retries = (list: readonly Retry[]): Stream.Stream<MonitorMsg> =>
	Stream.fromIterable([...list].sort((a, b) => a.at - b.at)).pipe(
		Stream.mapEffect((r) =>
			Effect.sleep(Duration.millis(Math.max(0, r.at - Date.now()))).pipe(
				Effect.as<MonitorMsg>({type: "retry_due", ref: r.ref}),
			),
		),
	);
