// Part 4's driver: the event log server's own write path, with a compare-and-set in its handler.
import {bundle, sleep, start} from "./harness.ts";

const IDLE = Number(process.env.IDLE ?? "16000");

export const main = async () => {
	const worker = await bundle("s4-entry.ts");
	const out: Record<string, unknown> = {bundle: {bytes: worker.bytes, gzip: worker.gzip}};
	const mf = await start(worker.code, {LOG: "LogObject"});
	await mf.ready;
	const post = async (base: number, text: string, name = "one") =>
		(await (
			await mf.dispatchFetch(`http://x/post?name=${name}&base=${base}&text=${text}`)
		).json()) as Record<string, unknown>;
	const stats = async (name = "one") =>
		(await (await mf.dispatchFetch(`http://x/stats?name=${name}`)).json()) as {
			wakes: number;
			counts: Record<string, number>;
			bytes: number;
		};
	const first = await post(0, "one");
	const second = await post(1, "two");
	const stale = await post(1, "stale");
	const s0 = await stats();
	// Five writers race for the same place. One must win and four must be refused.
	const racers = await Promise.all([0, 1, 2, 3, 4].map((i) => post(2, `racer${i}`)));
	const s1 = await stats();
	// The control: the same class, its Layer never built. No socket here, so sleep means eviction.
	const c1 = await stats("control");
	await sleep(IDLE);
	const s2 = await stats();
	const c2 = await stats("control");
	const ms: number[] = [];
	for (let i = 0; i < 200; i++) {
		const t0 = performance.now();
		await post(3 + i, "x");
		ms.push(performance.now() - t0);
	}
	const sorted = [...ms].sort((a, b) => a - b);
	out.writes = {first, second, stale, afterStale: s0.counts, racers, afterRace: s1.counts};
	out.sleep = {
		idleMs: IDLE,
		wakesBefore: s1.wakes,
		wakesAfterIdle: s2.wakes,
		controlBefore: c1.wakes,
		controlAfterIdle: c2.wakes,
	};
	out.speed = {
		writeP50Ms: Math.round((sorted[100] ?? 0) * 100) / 100,
		dbBytes: (await stats()).bytes,
	};
	await mf.dispose();
	return out;
};
