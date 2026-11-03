// Part 3's driver: a turn sleeps on its alarm, survives a kill, and resumes on a person's yes.
import {readFileSync} from "node:fs";
import {bundle, here, sleep, start} from "./harness.ts";

const CLOCK = Number(process.env.CLOCK ?? "20000");

export const main = async () => {
	const worker = await bundle("s3-entry.ts");
	const out: Record<string, unknown> = {
		bundle: {bytes: worker.bytes, gzip: worker.gzip},
		engineLines: readFileSync(here("alarm-engine.ts"), "utf8").split("\n").length,
	};
	const mf = await start(worker.code, {TURN: "TurnObject"});
	await mf.ready;
	const stats = async (name: string) =>
		(await (await mf.dispatchFetch(`http://x/stats?name=${name}`)).json()) as {
			wakes: number;
			ran: string[];
			result: string | null;
			alarm: number | null;
		};

	// A clean turn, with a clock long enough for the object to sleep under it.
	{
		await mf.dispatchFetch(`http://x/start?name=clean&clockMs=${CLOCK}`);
		await sleep(1000);
		const started = await stats("clean");
		await sleep(CLOCK + 2000);
		const afterClock = await stats("clean");
		const t0 = performance.now();
		await mf.dispatchFetch("http://x/approve?name=clean");
		let done = await stats("clean");
		while (done.result === null && performance.now() - t0 < 5000) {
			await sleep(20);
			done = await stats("clean");
		}
		out.clean = {started, afterClock, done, approvalToDoneMs: Math.round(performance.now() - t0)};
	}

	// The object dies inside the first activity. The alarm should bring the turn back by itself.
	{
		await mf.dispatchFetch("http://x/start?name=killed&clockMs=500&killDraft=1");
		await sleep(9000);
		const later = await stats("killed");
		await mf.dispatchFetch("http://x/approve?name=killed");
		await sleep(1500);
		const done = await stats("killed");
		out.killed = {later, done};
	}

	await mf.dispose();
	return out;
};
