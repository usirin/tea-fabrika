// What the window's `Link` would show, as a pure update over the ledger calls a host makes.
// Experiment 149's guess (149-wifi-blips/link.ts), with its false "slow" fixed.
//
// 149 found that after a hang the held calls land with long times, lift the p99, and show "slow"
// on a link that is fine again. Here a call's time counts only if it was sent after the link last
// came back: a call that waited out the drop says how long the drop was, not how fast the link is.
//
//   answered {ms: 40, at}      live
//   failed   {at}              away {since: at}: no answer (a refusal, or a call that timed out)
//   answered {ms: 1400, at}    slow, once the p99 of the last 20 counted answers is past 1 s
//
//   linkUpdate(away, {type: "answered", ms: 2900, at: 5000})
//   // {link: {state: "live"}, back: 5000, recent: [...]}: the call was sent while away, not counted
export type Link =
	| {readonly state: "live"}
	| {readonly state: "slow"; readonly ms: number}
	| {readonly state: "away"; readonly since: number; readonly waiting: number};

export type LinkMsg =
	| {readonly type: "answered"; readonly ms: number; readonly at: number}
	| {readonly type: "failed"; readonly at: number; readonly waiting: number};

export interface LinkModel {
	readonly link: Link;
	/** The last 20 counted answer times, newest last. */
	readonly recent: readonly number[];
	/** When the link last came back from away. A call sent before it is not counted. */
	readonly back: number;
}

export const LINK_START: LinkModel = {link: {state: "live"}, recent: [], back: 0};
const SLOW_MS = 1000;

const p99 = (xs: readonly number[]) => {
	const sorted = [...xs].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ?? 0;
};

const shown = (recent: readonly number[]): Link => {
	const slow = p99(recent);
	return slow > SLOW_MS ? {state: "slow", ms: slow} : {state: "live"};
};

export const linkUpdate = (s: LinkModel, m: LinkMsg): LinkModel => {
	if (m.type === "failed")
		return s.link.state === "away"
			? {...s, link: {...s.link, waiting: m.waiting}}
			: {...s, link: {state: "away", since: m.at, waiting: m.waiting}};
	// An answer while away: the link is back. The call itself waited out the drop.
	if (s.link.state === "away") return {...s, back: m.at, link: shown(s.recent)};
	// A call sent before the link came back waited out the drop too.
	if (m.at - m.ms < s.back) return s;
	const recent = [...s.recent, m.ms].slice(-20);
	return {...s, recent, link: shown(recent)};
};
