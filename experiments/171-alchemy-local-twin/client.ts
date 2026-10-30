// Experiment 171: a client of a running twin, through fabrika's own HTTP client (`layerHttp`) and
// the local door, as the app host would talk to it. Writes facts, or reads them back.
//
//   CLIENT_URL=http://127.0.0.1:18787 TWIN_SECRET=... node client.ts write 20   # register, 20 inbox events
//   CLIENT_URL=... TWIN_SECRET=... node client.ts read                         # how many, and their hash
//   CLIENT_URL=... TWIN_SECRET=... node client.ts ping 200                     # 200 reads, one at a time: ms each
//
// Prints one JSON line.
import {createHash} from "node:crypto";
import {Ledger} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";
import {Effect, Redacted} from "effect";

const url = process.env.CLIENT_URL ?? "";
const secret = Redacted.make(process.env.TWIN_SECRET ?? "fabrika_l_exp171");
const [what = "read", nArg = "10"] = process.argv.slice(2);
const n = Number(nArg);
const NAME = "exp171";
const INBOX = `${NAME}/inbox`;

const program = Effect.gen(function* () {
	const ledger = yield* Ledger;
	if (what === "write") {
		const reg = yield* ledger.register(NAME, "");
		const before = (yield* ledger.readStream(INBOX)).length;
		for (let i = 0; i < n; i++)
			yield* ledger.append(INBOX, "any", {
				kind: "note",
				writer: "",
				data: {n: before + i},
				id: `m${before + i}`,
			});
		return {registered: reg, wrote: n};
	}
	if (what === "ping") {
		const ms: number[] = [];
		for (let i = 0; i < n; i++) {
			const t = performance.now();
			yield* ledger.readLast(INBOX, 1);
			ms.push(performance.now() - t);
		}
		ms.sort((a, b) => a - b);
		const at = (q: number) => Math.round((ms[Math.floor(q * (ms.length - 1))] ?? 0) * 100) / 100;
		return {p50: at(0.5), p90: at(0.9), p99: at(0.99)};
	}
	const rows = yield* ledger.readStream(INBOX);
	const text = JSON.stringify(rows.map((r) => [r.rev, r.kind, r.data]));
	return {rows: rows.length, sha256: createHash("sha256").update(text).digest("hex").slice(0, 16)};
});

const out = await Effect.runPromise(
	program.pipe(Effect.scoped, Effect.provide(layerHttp({url, ledger: NAME, token: secret}))),
);
process.stdout.write(`${JSON.stringify(out)}\n`);
