// What the window's `Link` would show, as a pure update over the ledger calls a host makes. The
// sketch is section 5 of docs/direction/the-ledger-goes-to-cloudflare.md; the rules here are this
// experiment's guess at it, so the harness can say what a person would have seen.
//
//   answered {ms: 40}      live
//   failed   {at}          away {since: at}: no answer (a refusal, or a call that timed out)
//   answered {ms: 1400}    slow, once the p99 of the last 20 answers is past 1 s
//
//   linkUpdate({state: "live"}, {type: "failed", at: 1000, waiting: 2})
//   // {state: "away", since: 1000, waiting: 2}
export type Link =
	| {readonly state: "live"}
	| {readonly state: "slow"; readonly ms: number}
	| {readonly state: "away"; readonly since: number; readonly waiting: number};

export type LinkMsg =
	| {readonly type: "answered"; readonly ms: number}
	| {readonly type: "failed"; readonly at: number; readonly waiting: number};

export interface LinkModel {
	readonly link: Link;
	/** The last 20 answer times, newest last. */
	readonly recent: readonly number[];
}

export const LINK_START: LinkModel = {link: {state: "live"}, recent: []};
const SLOW_MS = 1000;

const p99 = (xs: readonly number[]) => {
	const sorted = [...xs].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
};

export const linkUpdate = (s: LinkModel, m: LinkMsg): LinkModel => {
	if (m.type === "failed")
		return s.link.state === "away"
			? {...s, link: {...s.link, waiting: m.waiting}}
			: {...s, link: {state: "away", since: m.at, waiting: m.waiting}};
	const recent = [...s.recent, m.ms].slice(-20);
	const slow = p99(recent);
	return {recent, link: slow > SLOW_MS ? {state: "slow", ms: slow} : {state: "live"}};
};
