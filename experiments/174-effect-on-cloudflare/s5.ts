// Part 5: what holds an object with no socket in memory, on the pinned runtime and on the newest.
// MINIFLARE_PATH, when set, is another Miniflare's entry file. COMPAT is the compatibility date.
import {bundle, sleep, start} from "./harness.ts";

const IDLE = Number(process.env.IDLE ?? "200000");
const COMPAT = process.env.COMPAT ?? "2026-07-01";

export const main = async () => {
	const worker = await bundle("s2-entry.ts");
	const mf = await start(worker.code, {CLUSTER: "ClusterObject"});
	await mf.ready;
	const wakes = async (name: string) =>
		((await (await mf.dispatchFetch(`http://x/stats?name=${name}`)).json()) as {wakes: number})
			.wakes;
	const hit = (path: string) => mf.dispatchFetch(`http://x${path}`).then((r) => r.text());

	await wakes("plain");
	await hit("/timer?name=timer");
	await hit("/hold?name=hold");
	await hit("/call?name=cluster&kind=single&id=1");
	const names = ["plain", "timer", "hold", "cluster"];
	const before = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await wakes(n)])));
	await sleep(IDLE);
	const after = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await wakes(n)])));
	await mf.dispose();
	return {
		idleMs: IDLE,
		compatibilityDate: COMPAT,
		before,
		after,
		slept: names.filter((n) => after[n] > before[n]),
	};
};
