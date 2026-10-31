import {Option} from "effect";
import {helloText, PONG_WAIT_MS, pingMs, readWelcome} from "./wire.ts";

// A peer's side of the pipe, as a pure machine a parent steps by hand: dial, hello, ping, and when
// it drops, retry once at once and then back off (T6, T7).
//
//   step({is: "dialing", ...}, {type: "opened"})       hello goes out
//   step({is: "hello", ...}, {type: "welcome", ...})   online
//   step({is: "online", ...}, {type: "closed"})        waiting, 0 ms: retry once at once
//   step({is: "waiting", ...}, {type: "retry", ...})   dialing again, with a new dial number

/** How long the first backed-off wait is, and the most any wait may be (T7). */
const FIRST_WAIT_MS = 250;
const MAX_WAIT_MS = 30_000;

/**
 * The wait before the next dial, after `tries` failed ones: nothing for the first, then
 * exponential, each one 80 to 120% at random, never more than 30 s. `rand` is in [0, 1).
 */
export const backoff = (tries: number, rand: number): number =>
	tries === 0 ? 0 : Math.min(MAX_WAIT_MS, FIRST_WAIT_MS * 2 ** (tries - 1) * (0.8 + 0.4 * rand));

/** One step of a small seeded generator (mulberry32): jitter with no impure call in the update. */
const nextRandom = (seed: number): {readonly rand: number; readonly seed: number} => {
	const s = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(s ^ (s >>> 15), 1 | s);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return {rand: ((t ^ (t >>> 14)) >>> 0) / 2 ** 32, seed: s};
};

type Common = {
	/** Which dial this is: the socket follows it, so a new number is a new socket. */
	readonly dial: number;
	readonly seed: number;
	/** What the peer asks for its ping, as the hello says it. */
	readonly ask: string;
	/** Dials failed since it was last online. */
	readonly tries: number;
};

export type Link =
	| (Common & {readonly is: "dialing"})
	| (Common & {readonly is: "hello"})
	| (Common & {readonly is: "waiting"; readonly wait: number})
	| (Common & {
			readonly is: "online";
			readonly ping: number;
			/** Which ping this is, so a late timer from an old one does nothing. */
			readonly beat: number;
			readonly pongDue: boolean;
	  });

export const startLink = (ask: string, seed: number): Link => ({
	is: "dialing",
	dial: 1,
	seed,
	ask,
	tries: 0,
});

export type LinkMsg =
	| {readonly type: "opened"; readonly dial: number}
	| {readonly type: "closed"; readonly dial: number}
	| {readonly type: "welcome"; readonly result: unknown}
	| {readonly type: "pong"}
	| {readonly type: "ping_due"; readonly beat: number}
	| {readonly type: "pong_late"; readonly beat: number}
	| {readonly type: "dial_late"; readonly dial: number}
	| {readonly type: "retry"; readonly dial: number};

/** What a step asks of its parent: text for the pipe, and did it just come online. */
export type LinkStep = {
	readonly link: Link;
	readonly send: readonly string[];
	readonly online: boolean;
};

const stay = (link: Link): LinkStep => ({link, send: [], online: false});

const drop = (link: Link): LinkStep => {
	const {rand, seed} = nextRandom(link.seed);
	return stay({
		is: "waiting",
		dial: link.dial,
		seed,
		ask: link.ask,
		tries: link.tries + 1,
		wait: backoff(link.tries, rand),
	});
};

export const stepLink = (link: Link, msg: LinkMsg): LinkStep => {
	switch (msg.type) {
		case "opened":
			return link.is === "dialing" && msg.dial === link.dial
				? {link: {...link, is: "hello"}, send: [helloText([], link.ask)], online: false}
				: stay(link);
		case "welcome": {
			if (link.is !== "hello") return stay(link);
			const ping = Option.getOrElse(readWelcome(msg.result), () => link.ask);
			return {
				link: {...link, is: "online", tries: 0, ping: pingMs(ping), beat: 0, pongDue: false},
				send: [],
				online: true,
			};
		}
		case "closed":
			return msg.dial === link.dial && link.is !== "waiting" ? drop(link) : stay(link);
		case "dial_late":
			return msg.dial === link.dial && (link.is === "dialing" || link.is === "hello")
				? drop(link)
				: stay(link);
		case "retry":
			return link.is === "waiting" && msg.dial === link.dial
				? stay({
						is: "dialing",
						dial: link.dial + 1,
						seed: link.seed,
						ask: link.ask,
						tries: link.tries,
					})
				: stay(link);
		case "ping_due":
			return link.is === "online" && msg.beat === link.beat && !link.pongDue
				? {link: {...link, pongDue: true}, send: ["ping"], online: false}
				: stay(link);
		case "pong":
			return link.is === "online" && link.pongDue
				? stay({...link, pongDue: false, beat: link.beat + 1})
				: stay(link);
		case "pong_late":
			return link.is === "online" && msg.beat === link.beat && link.pongDue
				? drop(link)
				: stay(link);
	}
};

/** The one timer a link wants now: only one can matter in each state. */
export const linkTimer = (link: Link): {readonly ms: number; readonly msg: LinkMsg} => {
	switch (link.is) {
		case "dialing":
		case "hello":
			return {ms: PONG_WAIT_MS, msg: {type: "dial_late", dial: link.dial}};
		case "waiting":
			return {ms: link.wait, msg: {type: "retry", dial: link.dial}};
		case "online":
			return link.pongDue
				? {ms: PONG_WAIT_MS, msg: {type: "pong_late", beat: link.beat}}
				: {ms: link.ping, msg: {type: "ping_due", beat: link.beat}};
	}
};
