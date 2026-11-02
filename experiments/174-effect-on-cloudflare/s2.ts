// Part 2's driver: does Effect's cluster run in one object, and can that object ever sleep?
import {bundle, sleep, start} from "./harness.ts";

const IDLE = Number(process.env.IDLE ?? "16000");
const LONG = Number(process.env.LONG ?? "0");

export const main = async () => {
	const worker = await bundle("s2-entry.ts");
	const out: Record<string, unknown> = {bundle: {bytes: worker.bytes, gzip: worker.gzip}};
	const mf = await start(worker.code, {CLUSTER: "ClusterObject"});
	await mf.ready;
	const stats = async (name: string) =>
		(await (await mf.dispatchFetch(`http://x/stats?name=${name}`)).json()) as {
			wakes: number;
			execs: number;
			tables: string[];
			bytes: number;
		};
	const call = async (name: string, kind: string, id: string) => {
		const t0 = performance.now();
		const r = (await (
			await mf.dispatchFetch(`http://x/call?name=${name}&kind=${kind}&id=${id}`)
		).json()) as Record<string, unknown>;
		return {...r, wallMs: Math.round(performance.now() - t0)};
	};

	for (const kind of ["test", "single", "tuned"]) {
		const name = `obj-${kind}`;
		const first = await call(name, kind, "1");
		const second = await call(name, kind, "2");
		const dup = await call(name, kind, "2");
		const s0 = await stats(name);
		await sleep(IDLE);
		const s1 = await stats(name);
		const afterIdle = await call(name, kind, "3");
		out[kind] = {
			first,
			second,
			sameIdAgain: dup,
			wakesBeforeIdle: s0.wakes,
			wakesAfterIdle: s1.wakes,
			statementsDuringIdle: s1.execs - s0.execs,
			statementsStart: s0.execs,
			tables: s0.tables.length,
			dbBytes: s0.bytes,
			afterIdle,
		};
	}
	// Kill the object, then send a message id it already answered: is the stored reply still there?
	{
		await mf.dispatchFetch("http://x/abort?name=obj-single").catch(() => undefined);
		await sleep(300);
		const sameId = await call("obj-single", "single", "2");
		const fresh = await call("obj-single", "single", "4");
		const s = await stats("obj-single");
		out.afterKill = {sameId, fresh, wakes: s.wakes};
	}
	if (LONG > 0) {
		const s0 = await stats("obj-tuned");
		const d0 = await stats("obj-single");
		await sleep(LONG);
		const s1 = await stats("obj-tuned");
		const d1 = await stats("obj-single");
		out.long = {
			idleMs: LONG,
			tuned: {wakes: [s0.wakes, s1.wakes], statements: s1.execs - s0.execs},
			single: {wakes: [d0.wakes, d1.wakes], statements: d1.execs - d0.execs},
		};
	}
	await mf.dispose();
	return out;
};
