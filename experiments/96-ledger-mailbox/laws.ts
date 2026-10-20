// The new laws of the mailbox ledger. Like experiment 93's laws (which run here unchanged: every
// API change is additive), each needs only a LedgerClient, so the same code runs against the
// Durable Object and against node:sqlite. The tail's law needs processes and lives in the harness.
import type {LedgerClient} from "./client.ts";
import type {AppendResult} from "./sql.ts";

export type LawResult = {law: string; pass: boolean; numbers: string};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
/** A fresh stream name per law, so laws never see each other's events. */
export const fresh = (tag: string) => `${tag}-${Date.now().toString(36)}-${seq++}`;

const word = (r: AppendResult) => (r.ok ? (r.dup ? "dup" : "ok") : r.why);
const tally = (rs: readonly AppendResult[]) => {
	const t: Record<string, number> = {};
	for (const r of rs) t[word(r)] = (t[word(r)] ?? 0) + 1;
	return t;
};
const show = (t: Record<string, number>) =>
	Object.entries(t)
		.map(([k, v]) => `${k} ${v}`)
		.join(", ");

/** 11a. Senders that append at the end never race: no `stale`, and the revs are 1..n. */
export async function law11AppendAny(c: LedgerClient, n = 50): Promise<LawResult> {
	const s = fresh("l11a");
	const rs = await Promise.all(
		Array.from({length: n}, (_, i) =>
			c.append(s, "any", {kind: "inc", writer: `w${i}`, id: `m${i}`}),
		),
	);
	const revs = rs.flatMap((r) => (r.ok ? [r.rev] : [])).sort((a, b) => a - b);
	const rows = await c.readStream(s);
	const gapless = rows.every((r, i) => Number(r.rev) === i + 1);
	return {
		law: `11a. ${n} appends at once on one stream, rev "any"`,
		pass: revs.length === n && revs.every((r, i) => r === i + 1) && rows.length === n && gapless,
		numbers: `${show(tally(rs))}; rows ${rows.length}; revs 1..${revs.at(-1)} gapless ${gapless}`,
	};
}

/** 11b. The same message id, sent many times at once (and again later): it lands once. */
export async function law11RepeatedId(c: LedgerClient, n = 50): Promise<LawResult> {
	const s = fresh("l11b");
	const rs = await Promise.all(
		Array.from({length: n}, (_, i) =>
			c.append(s, "any", {kind: "inc", writer: `w${i}`, id: "same"}),
		),
	);
	const later = await c.append(s, "any", {kind: "inc", writer: "late", id: "same"});
	// A compare-and-set append with a repeated id is answered the same way, whatever rev it names.
	const cas = await c.append(s, 7, {kind: "inc", writer: "cas", id: "same"});
	const other = await c.append(`${s}-other`, "any", {kind: "inc", writer: "w", id: "same"});
	const rows = await c.readStream(s);
	const places = new Set(rs.flatMap((r) => (r.ok ? [`${r.pos}/${r.rev}`] : [])));
	const t = tally(rs);
	return {
		law: `11b. one message id appended ${n} times at once, then twice more: it lands once`,
		pass:
			rows.length === 1 &&
			t.ok === 1 &&
			t.dup === n - 1 &&
			places.size === 1 &&
			word(later) === "dup" &&
			word(cas) === "dup" &&
			word(other) === "ok",
		numbers: `${show(t)}; one place for all ${places.size === 1}; later ${word(later)}; with a stale rev ${word(cas)}; same id on another stream ${word(other)}; rows ${rows.length}`,
	};
}

/**
 * 12. A lease on `p` guards `p` and every stream under `p/`, and nothing else. An old fence is
 * refused under the prefix both after a reclaim and in the window before anyone reclaims, while
 * the state stream's rev still matches: only the fence can refuse those two.
 */
export async function law12PrefixFence(c: LedgerClient): Promise<LawResult> {
	const p = fresh("l12");
	const state = `${p}/state`;
	const deep = `${p}/a/b`;
	const steps: string[] = [];
	const c1 = await c.claim(p, "h1", 0, 800);
	if (!c1.ok) return {law: "12. prefix lease", pass: false, numbers: `claim 1 ${c1.why}`};
	const w1 = await c.append(state, 0, {kind: "state", writer: "h1", id: "save-1"}, c1.fence);
	const wDeep = await c.append(deep, "any", {kind: "note", writer: "h1"}, c1.fence);
	const wrong = await c.append(state, 1, {kind: "state", writer: "x"}, c1.fence + 1000);
	// Not under `p`: a sibling whose name starts the same, and an unrelated stream.
	const sibling = await c.append(`${p}0/state`, 0, {kind: "state", writer: "h1"}, c1.fence);
	const sibling2 = await c.append(`${p}x`, 0, {kind: "state", writer: "h1"}, c1.fence);
	await sleep(1000);
	// Alone: the lease ran out, nobody has claimed, and rev 1 is still the state stream's end.
	const alone = await c.append(state, 1, {kind: "state", writer: "h1"}, c1.fence);
	const c2 = await c.claim(p, "h2", c1.rev, 30_000);
	if (!c2.ok) return {law: "12. prefix lease", pass: false, numbers: `claim 2 ${c2.why}`};
	// Zombie: another host claimed; the state stream has not moved, so its rev still matches.
	const zombie = await c.append(state, 1, {kind: "state", writer: "h1"}, c1.fence);
	// A repeat of a save that landed under the old fence: the fence answers first, not the id.
	const zombieRepeat = await c.append(
		state,
		0,
		{kind: "state", writer: "h1", id: "save-1"},
		c1.fence,
	);
	const fresh2 = await c.append(state, 1, {kind: "state", writer: "h2"}, c2.fence);
	const repeatLive = await c.append(
		state,
		0,
		{kind: "state", writer: "h2", id: "save-1"},
		c2.fence,
	);
	const rows = await c.readStream(state);
	steps.push(`under the live fence: ${word(w1)}, deeper ${word(wDeep)}`);
	steps.push(`a fence that is no lease: ${word(wrong)}`);
	steps.push(`sibling ${p}0/state: ${word(sibling)}, ${p}x: ${word(sibling2)}`);
	steps.push(`old fence after expiry, nobody claimed: ${word(alone)}`);
	steps.push(`fence ${c1.fence} -> ${c2.fence}; old fence after the reclaim: ${word(zombie)}`);
	steps.push(
		`a repeated id under the old fence: ${word(zombieRepeat)}, under the live one: ${word(repeatLive)}`,
	);
	steps.push(`new fence: ${word(fresh2)}; state rows ${rows.length}`);
	return {
		law: "12. a lease on p guards p/*: an old fence is refused there, and only there",
		pass:
			word(w1) === "ok" &&
			word(wDeep) === "ok" &&
			word(wrong) === "fenced" &&
			word(sibling) === "fenced" &&
			word(sibling2) === "fenced" &&
			word(alone) === "fenced" &&
			word(zombie) === "fenced" &&
			word(zombieRepeat) === "fenced" &&
			word(repeatLive) === "dup" &&
			word(fresh2) === "ok" &&
			rows.length === 2,
		numbers: steps.join("; "),
	};
}

/** 14. Reads from a rev, and reads under a prefix, return exactly what they name, in order. */
export async function law14Reads(c: LedgerClient): Promise<LawResult> {
	const p = fresh("l14");
	const names = [p, `${p}/x`, `${p}/y`, `${p}x`, `${p}/x`, `${p}0`, `${p}/y/z`, `${p}/x`];
	let first = -1;
	for (const s of names) {
		const r = await c.append(s, "any", {kind: "note", writer: "w"});
		if (first < 0 && r.ok) first = r.pos;
	}
	const under = await c.read(first - 1, 100, p);
	const want = names.filter((s) => s === p || s.startsWith(`${p}/`));
	const fromRev = await c.readStream(`${p}/x`, 1);
	const page = await c.readStream(`${p}/x`, 0, 2);
	const last = await c.readLast(`${p}/x`, 2);
	const none = await c.readLast(`${p}/nothing`, 1);
	const inOrder = under.every((r, i) => i === 0 || Number(r.pos) > Number(under[i - 1]?.pos));
	return {
		law: "14. reads from a rev, and under a prefix, return exactly what they name",
		pass:
			under.length === want.length &&
			under.every((r, i) => r.stream === want[i]) &&
			inOrder &&
			fromRev.map((r) => r.rev).join(",") === "2,3" &&
			page.map((r) => r.rev).join(",") === "1,2" &&
			last.map((r) => r.rev).join(",") === "2,3" &&
			none.length === 0,
		numbers: `under ${p}: ${under.length} of ${want.length} (siblings ${p}x and ${p}0 left out ${under.every((r) => r.stream !== `${p}x` && r.stream !== `${p}0`)}); ${p}/x after rev 1: revs ${fromRev.map((r) => r.rev).join(",")}; first page of 2: ${page.map((r) => r.rev).join(",")}; last 2: ${last.map((r) => r.rev).join(",")}; last of an empty stream: ${none.length} rows`,
	};
}
