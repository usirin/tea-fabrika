// The laws that need only a LedgerClient, so the same code runs against the Durable Object
// and against node:sqlite. Each returns pass/fail with the numbers behind it.
import type {LedgerClient} from "./client.ts";

export type LawResult = {law: string; pass: boolean; numbers: string};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
/** A fresh stream name per law, so laws never see each other's events. */
export const fresh = (tag: string) => `${tag}-${Date.now().toString(36)}-${seq++}`;

const tally = (rs: ReadonlyArray<{ok: boolean; why?: string}>) => {
	const t: Record<string, number> = {};
	for (const r of rs) {
		const k = r.ok ? "ok" : (r.why ?? "?");
		t[k] = (t[k] ?? 0) + 1;
	}
	return t;
};
const show = (t: Record<string, number>) =>
	Object.entries(t)
		.map(([k, v]) => `${k} ${v}`)
		.join(", ");

export async function law1Claims(c: LedgerClient, n = 50): Promise<LawResult> {
	const s = fresh("l1");
	const rs = await Promise.all(Array.from({length: n}, (_, i) => c.claim(s, `h${i}`, 0, 30_000)));
	const t = tally(rs);
	const claimed = (await c.readStream(s)).filter((e) => e.kind === "claimed").length;
	return {
		law: `1. ${n} claims at once on one ticket`,
		pass: t.ok === 1 && (t.held ?? 0) + (t.stale ?? 0) === n - 1 && claimed === 1,
		numbers: `${show(t)}; claimed events ${claimed}`,
	};
}

export async function law2Appends(c: LedgerClient, n = 50): Promise<LawResult[]> {
	const tag = fresh("l2");
	const t0 = performance.now();
	const many = await Promise.all(
		Array.from({length: n}, (_, i) => c.append(`${tag}-${i}`, 0, {kind: "note", writer: "w"})),
	);
	const ms = performance.now() - t0;
	const pos = new Set(many.flatMap((r) => (r.ok ? [r.pos] : [])));
	const a = tally(many);
	const s = fresh("l2one");
	const one = tally(
		await Promise.all(
			Array.from({length: n}, (_, i) => c.append(s, 0, {kind: "note", writer: `w${i}`})),
		),
	);
	const rows = (await c.readStream(s)).length;
	return [
		{
			law: `2a. ${n} appends at once on ${n} tickets`,
			pass: a.ok === n && pos.size === n,
			numbers: `${show(a)}; distinct pos ${pos.size}; ${ms.toFixed(0)} ms`,
		},
		{
			law: `2b. ${n} appends at once on one ticket, same expectedRev`,
			pass: one.ok === 1 && one.stale === n - 1 && rows === 1,
			numbers: `${show(one)}; rows ${rows}`,
		},
	];
}

export async function law3Fencing(c: LedgerClient): Promise<LawResult> {
	const s = fresh("l3");
	const steps: string[] = [];
	const a1 = await c.append(s, 0, {kind: "note", writer: "w"});
	const stale = await c.append(s, 0, {kind: "note", writer: "w"});
	steps.push(`stale rev: ${stale.ok ? "ok" : stale.why}`);
	const c1 = await c.claim(s, "h1", 1, 800);
	if (!c1.ok)
		return {law: "3. stale rev and old fence refused", pass: false, numbers: `claim 1 ${c1.why}`};
	const w1 = await c.append(s, c1.rev, {kind: "note", writer: "h1"}, c1.fence);
	await sleep(1000);
	const c2 = await c.claim(s, "h2", w1.ok ? w1.rev : c1.rev, 30_000);
	if (!c2.ok)
		return {law: "3. stale rev and old fence refused", pass: false, numbers: `claim 2 ${c2.why}`};
	const old = await c.append(s, c2.rev, {kind: "note", writer: "h1"}, c1.fence);
	const cur = await c.append(s, c2.rev, {kind: "note", writer: "h2"}, c2.fence);
	steps.push(`h1 write with its live fence: ${w1.ok ? "ok" : w1.why}`);
	steps.push(`fence ${c1.fence} -> ${c2.fence}`);
	steps.push(`old fence after reclaim: ${old.ok ? "ok" : old.why}`);
	steps.push(`new fence: ${cur.ok ? "ok" : cur.why}`);
	return {
		law: "3. stale rev and old fence refused",
		pass:
			a1.ok &&
			!stale.ok &&
			stale.why === "stale" &&
			w1.ok &&
			c2.fence > c1.fence &&
			!old.ok &&
			old.why === "fenced" &&
			cur.ok,
		numbers: steps.join("; "),
	};
}

/** Needs an alarm, so the Durable Object only. `graceMs` is the ledger's EXPIRY_GRACE_MS. */
export async function law4Expiry(c: LedgerClient, graceMs: number): Promise<LawResult[]> {
	const ttl = 2000;
	const a = fresh("l4a");
	const ca = await c.claim(a, "h1", 0, ttl);
	const t0 = Date.now();
	let expiredAfter = -1;
	while (Date.now() - t0 < ttl + graceMs + 5000) {
		await sleep(100);
		if ((await c.readStream(a)).some((e) => e.kind === "lease_expired")) {
			expiredAfter = Date.now() - t0;
			break;
		}
	}
	const leaseGone = (await c.lease(a)) === null;

	const b = fresh("l4b");
	const cb1 = await c.claim(b, "h1", 0, ttl);
	await sleep(ttl + Math.min(300, graceMs / 3));
	const beforeAlarm = (await c.readStream(b)).filter((e) => e.kind === "lease_expired").length;
	const cb2 = await c.claim(b, "h2", cb1.ok ? cb1.rev : 0, 30_000);
	await sleep(graceMs + 1500);
	const afterAlarm = (await c.readStream(b)).filter((e) => e.kind === "lease_expired").length;
	const holder = (await c.lease(b))?.holder;
	return [
		{
			law: "4a. ttl 2 s, no renew: the alarm writes lease_expired",
			pass: ca.ok && expiredAfter > 0 && leaseGone,
			numbers: `lease_expired after ${expiredAfter} ms (ttl ${ttl} + grace ${graceMs}); lease row gone ${leaseGone}`,
		},
		{
			law: "4b. claim after expires_at, alarm not yet fired (lazy expiry)",
			pass:
				cb1.ok &&
				cb2.ok &&
				cb2.fence > cb1.fence &&
				beforeAlarm === 0 &&
				afterAlarm === 0 &&
				holder === "h2",
			numbers: `second claim ${cb2.ok ? "ok" : cb2.why}, fence ${cb1.ok ? cb1.fence : "?"} -> ${cb2.ok ? cb2.fence : "?"}; lease_expired before ${beforeAlarm}, after the alarm ${afterAlarm} (guard kept the new lease); holder ${holder}`,
		},
	];
}

export async function law5Stop(c: LedgerClient): Promise<LawResult> {
	const s = fresh("l5");
	const cl = await c.claim(s, "h1", 0, 30_000);
	if (!cl.ok)
		return {law: "5. renew says stop after cancel", pass: false, numbers: `claim ${cl.why}`};
	const before = await c.renew(s, cl.fence, 30_000);
	const wrong = await c.renew(s, cl.fence + 1000, 30_000);
	await c.cancel(s, "owner");
	const after = await c.renew(s, cl.fence, 30_000);
	const word = (r: {ok: boolean; why?: string}) => (r.ok ? "ok" : (r.why ?? "?"));
	return {
		law: "5. renew says stop after cancel",
		pass: before.ok && !wrong.ok && wrong.why === "lost" && !after.ok && after.why === "stop",
		numbers: `renew before ${word(before)}; wrong fence ${word(wrong)}; after cancel ${word(after)}`,
	};
}

export async function law6View(c: LedgerClient): Promise<LawResult> {
	const s = fresh("l6");
	await c.append(s, 0, {kind: "criterion_added", writer: "w", data: {id: "c1", text: "one"}});
	await c.append(s, 1, {kind: "criterion_added", writer: "w", data: {id: "c2", text: "two"}});
	await c.append(s, 2, {kind: "criterion_met", writer: "w", data: {id: "c1"}});
	const open = await c.openCriteria(s);
	const w = await c.tryExec(
		`INSERT INTO open_criteria (stream, id, text, pos) VALUES ('${s}', 'x', 'y', 1)`,
	);
	return {
		law: "6. writing to the VIEW fails",
		pass: !w.ok && open.length === 1 && open[0]?.id === "c2",
		numbers: `open ${open.map((r) => r.id).join(",")}; write: ${w.ok ? "accepted" : w.error}`,
	};
}
