// One "host": a separate Node process that races claims against a running Miniflare over
// HTTP. BASE the ledger's URL, LEDGER its name, STREAMS the tickets (comma list), PER claims
// per ticket at once, START_AT the wall-clock ms to fire at, WHO this host's name. Prints one
// JSON line: the winners it saw, and a count of every answer.
import {fetchPost, httpClient} from "./client.ts";

const env = (k: string) => process.env[k] ?? "";
const c = httpClient(fetchPost(env("BASE")), env("LEDGER"));
const streams = env("STREAMS").split(",");
const per = Number(env("PER") || "10");
const who = env("WHO");

// INFLIGHT caps the requests open at once (0: no cap). A burst of 200 new connections overruns
// the listen backlog (128 on macOS) and some are reset before they reach the ledger.
const inflight = Number(env("INFLIGHT") || "0");
const jobs = streams.flatMap((s) => Array.from({length: per}, (_, i) => ({s, i})));
const one = ({s, i}: {s: string; i: number}) =>
	c.claim(s, `${who}-${i}`, 0, 60_000).then(
		(r) => ({s, r: r.ok ? "ok" : r.why}),
		(e: unknown) => {
			const cause = e instanceof Error && e.cause instanceof Error ? ` ${e.cause.message}` : "";
			return {s, r: `error ${e instanceof Error ? e.message : String(e)}${cause}`};
		},
	);

await new Promise((r) => setTimeout(r, Math.max(0, Number(env("START_AT")) - Date.now())));
const out: {s: string; r: string}[] = [];
if (inflight === 0) out.push(...(await Promise.all(jobs.map(one))));
else {
	let next = 0;
	await Promise.all(
		Array.from({length: inflight}, async () => {
			while (next < jobs.length) {
				const job = jobs[next++];
				if (job) out.push(await one(job));
			}
		}),
	);
}
const counts: Record<string, number> = {};
for (const o of out) counts[o.r] = (counts[o.r] ?? 0) + 1;
const won = out.filter((o) => o.r === "ok").map((o) => o.s);
process.stdout.write(`${JSON.stringify({who, won, counts})}\n`);
