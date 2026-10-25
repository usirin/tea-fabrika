// Experiment 149, part A: how often does this laptop's link really drop, and for how long?
//
//   node experiments/149-wifi-blips/link-log.ts <link log> [<pmset log>]
//
// The link log is one line every 10 s from a small logger (one curl to Cloudflare, one to
// Anthropic, 5 s timeout each):
//
//   <unix seconds> cf <http code> <seconds> an <http code> <seconds>
//
// Any http code counts as up (a 404 is an answer); `000` is no answer. The pmset log is the output
// of `pmset -g log`; its Sleep and Wake lines mark when the laptop slept, and a sleep is not a drop.
// Without it, a gap of more than 30 s between two lines counts as asleep.
//
// It prints counts only: hours covered, drops a day, drop length (median and p95, at the logger's
// 10 s grain), and how often Cloudflare had no answer while Anthropic did. Never a time of day, never
// a line of the log: when someone works is not ours to publish.
//
// Node at the edge: node:fs, to read two local files.
import {readFileSync} from "node:fs";

interface Sample {
	readonly at: number;
	readonly cf: boolean;
	readonly an: boolean;
}

const STEP_S = 10;

const parseLink = (text: string): Sample[] =>
	text
		.split("\n")
		.map((line) => line.trim().split(/\s+/))
		.filter((f) => f.length >= 7 && f[1] === "cf" && f[4] === "an")
		.map((f) => ({at: Number(f[0]), cf: f[2] !== "000", an: f[5] !== "000"}))
		.filter((s) => Number.isFinite(s.at))
		.sort((a, b) => a.at - b.at);

/** Asleep spans from `pmset -g log`: from each Sleep to the next Wake or DarkWake, in unix seconds. */
const parseSleeps = (text: string): Array<readonly [number, number]> => {
	const marks = text
		.split("\n")
		.map((line) => /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d [+-]\d{4}) (Sleep|Wake|DarkWake)\s/.exec(line))
		.filter((m) => m !== null)
		.map((m) => ({
			at: Date.parse((m[1] ?? "").replace(" ", "T").replace(/ ([+-]\d\d)(\d\d)$/, "$1:$2")) / 1000,
			kind: m[2],
		}));
	const spans: Array<readonly [number, number]> = [];
	let since: number | null = null;
	for (const m of marks) {
		if (m.kind === "Sleep") since ??= m.at;
		else if (since !== null) {
			spans.push([since, m.at]);
			since = null;
		}
	}
	return spans;
};

const percentile = (xs: readonly number[], p: number) => {
	if (xs.length === 0) return null;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] ?? null;
};

export const countLink = (
	samples: readonly Sample[],
	sleeps: ReadonlyArray<readonly [number, number]>,
) => {
	const asleep = (a: number, b: number) =>
		sleeps.some(([s, w]) => s < b && w > a) || (sleeps.length === 0 && b - a > 3 * STEP_S);
	let awakeS = 0;
	const drops: number[] = [];
	let cfOnly = 0;
	let run = 0;
	let runCfOnly = true;
	const close = () => {
		if (run > 0) {
			drops.push(run * STEP_S);
			if (runCfOnly) cfOnly++;
		}
		run = 0;
		runCfOnly = true;
	};
	for (let i = 0; i < samples.length; i++) {
		const s = samples[i] as Sample;
		const prev = samples[i - 1];
		if (prev !== undefined) {
			if (asleep(prev.at, s.at)) close();
			else awakeS += s.at - prev.at;
		}
		// A drop is a try where the ledger's road (Cloudflare) gave no answer.
		if (!s.cf) {
			run++;
			if (!s.an) runCfOnly = false;
		} else close();
	}
	close();
	const days = awakeS / 86_400;
	return {
		samples: samples.length,
		awakeHours: Math.round((awakeS / 3600) * 10) / 10,
		drops: drops.length,
		dropsPerDay: days > 0 ? Math.round((drops.length / days) * 10) / 10 : null,
		dropMedianS: percentile(drops, 0.5),
		dropP95S: percentile(drops, 0.95),
		dropMaxS: drops.length > 0 ? Math.max(...drops) : null,
		cloudflareDownAnthropicUp: cfOnly,
		anthropicDownSamples: samples.filter((s) => !s.an).length,
		grainS: STEP_S,
	};
};

if (import.meta.main) {
	const [linkPath, pmsetPath] = process.argv.slice(2);
	if (linkPath === undefined) {
		console.error("usage: node link-log.ts <link log> [<pmset log>]");
		process.exit(2);
	}
	const samples = parseLink(readFileSync(linkPath, "utf8"));
	const sleeps = pmsetPath === undefined ? [] : parseSleeps(readFileSync(pmsetPath, "utf8"));
	console.log(JSON.stringify(countLink(samples, sleeps), null, "\t"));
}
