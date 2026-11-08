// P15a, next/. CodeRegistry tests do not require P12, P14's runtime or P34.
import {mkdtempSync, rmSync} from "node:fs";
import {Effect, Layer, Schema, Stream} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {
	checks,
	code,
	disk,
	failure,
	from,
	release,
	request,
	typeId,
} from "../app/reload.test-support.ts";
import {LedgerTransaction} from "../data/ledger-transaction.ts";
import {Doorbell, Ledger} from "../data/ledger.ts";
import {brainOnly} from "./process.ts";

const registry = async () => {
	const {CodeRegistry} = await import("./code-registry.ts");
	const folder = mkdtempSync("/tmp/p15-reg.");
	const bytes = disk(folder, "bytes");
	const log = disk(folder, "ledger");
	const bell = Layer.succeed(Doorbell, {ring: () => Effect.void});
	const tx = LedgerTransaction.layer(log.sql).pipe(Layer.provide(bell));
	const layer = CodeRegistry.layer(bytes.sql, {brain: from.by}).pipe(Layer.provide(tx));
	const run = <A, E>(f: (r: typeof CodeRegistry.Service) => Effect.Effect<A, E>) =>
		Effect.runPromise(CodeRegistry.use(f).pipe(Effect.provide(layer)));
	const all = async () => {
		const names = log.sql.exec("SELECT DISTINCT stream FROM entries ORDER BY stream");
		const rows = [];
		for (const name of names)
			rows.push(
				...(await Effect.runPromise(
					Ledger.use((l) =>
						Stream.runCollect(l.read(Schema.decodeUnknownSync(Schema.String)(name.stream), 0)),
					).pipe(
						Effect.provide(
							Ledger.sql(log.sql, {reader: "registry-test"}).pipe(Layer.provide(bell)),
						),
					),
				)),
			);
		return rows.sort((a, b) => a.rev - b.rev);
	};
	return {
		run,
		all,
		bytes,
		log,
		layer,
		CodeRegistry,
		reopen: () => {
			bytes.reopen();
			log.reopen();
		},
		close: () => {
			bytes.close();
			log.close();
			rmSync(folder, {recursive: true, force: true});
		},
	};
};

describe("P15a immutable code and trusted facts", () => {
	it("stored bundles survive reopen; emitted and transitive bytes determine release identity", async () => {
		// Plant: memory-only bytes, hash source before compile, or omit runtime/transitive outputs.
		await fc.assert(
			fc.asyncProperty(fc.string(), async (text) => {
				const r = await registry();
				try {
					const bundle = await release("counter", text);
					expect(await r.run((s) => s.put(bundle))).toEqual(bundle);
					r.reopen();
					expect(await r.run((s) => s.get(bundle.hash))).toEqual(bundle);
					for (const bad of [
						{...bundle, program: "another"},
						{...bundle, runtime: "b".repeat(64)},
						{...bundle, worker: "missing.js"},
						{
							...bundle,
							files: bundle.files.map((f, i) =>
								i === 0 ? {...f, source: `${f.source}\n// edit`} : f,
							),
						},
					]) {
						expect(
							await failure(r.CodeRegistry.use((s) => s.put(bad)).pipe(Effect.provide(r.layer))),
						).toMatchObject({_tag: "CodeError"});
						expect(await r.run((s) => s.get(bundle.hash))).toEqual(bundle);
					}
					expect(
						await r.run((s) => s.put({...bundle, files: [...bundle.files].reverse()})),
					).toEqual(bundle);
				} finally {
					r.close();
				}
			}),
			checks,
		);
	});
	it("malformed bundles fail typed and valid controls still pass", async () => {
		// Plant: synchronous decode throws, unchecked path/hash, or blanket refusal of every bundle.
		await fc.assert(
			fc.asyncProperty(
				fc.jsonValue(),
				fc.constantFrom("hash", "path", "worker", "window", "bytes"),
				async (raw, kind) => {
					const r = await registry();
					try {
						const bundle = await release("counter", JSON.stringify(raw));
						const bad =
							kind === "hash"
								? {...bundle, hash: "G".repeat(64)}
								: kind === "path"
									? {...bundle, files: [{path: "../escape.js", source: "x"}]}
									: kind === "worker"
										? {...bundle, worker: raw}
										: kind === "window"
											? {...bundle, window: "a".repeat(63)}
											: {...bundle, files: [{path: "worker.js", source: raw}]};
						const before = structuredClone(bad);
						expect(
							await failure(r.CodeRegistry.use((s) => s.put(bad)).pipe(Effect.provide(r.layer))),
						).toMatchObject({_tag: "CodeError"});
						expect(bad).toEqual(before);
						expect(await r.run((s) => s.put(bundle))).toEqual(bundle);
					} finally {
						r.close();
					}
				},
			),
			checks,
		);
	});
	it("public append and program-write checks reserve every code-control case", () => {
		// Plant: add cases to CodeFact but forget brainOnly/runtime-reserved tags.
		fc.assert(
			fc.property(
				fc.constantFrom(
					"code.loaded",
					"code.refused",
					"code.failed",
					"step.crashed",
					"code.rolled_back",
				),
				fc.string({minLength: 1}),
				fc.nat(),
				(tag, stream, n) => {
					expect(brainOnly({stream, id: typeId("entry", n), tag})).toBe(true);
					expect(
						brainOnly({stream: "ordinary", id: typeId("entry", n), tag: "ordinary.saved"}),
					).toBe(false);
				},
			),
			checks,
		);
	});
	it("record checks brain authority and retries its saved entry ID once", async () => {
		// Plant: trust caller text, allocate on retry, or let a client write a fake selection.
		await fc.assert(
			fc.asyncProperty(
				fc.string({minLength: 1}).filter((s) => s !== from.by),
				fc.integer({min: 1, max: 6}),
				async (caller, retries) => {
					const r = await registry();
					try {
						const {CodeFact, EntryId} = await code();
						const bundle = await release("counter", caller);
						const req = await request(bundle, 1);
						const id = Schema.decodeUnknownSync(EntryId)(typeId("entry", 1));
						const fact = CodeFact.cases["code.loaded"].make({
							request: req.id,
							program: "counter",
							process: null,
							hash: bundle.hash,
							window: bundle.window,
							was: null,
							from: "watch",
						});
						await r.run((s) => s.put(bundle));
						expect(
							await failure(
								r.CodeRegistry.use((s) => s.record(id, fact, {...from, by: caller})).pipe(
									Effect.provide(r.layer),
								),
							),
						).toMatchObject({_tag: "LedgerError"});
						const first = await r.run((s) => s.record(id, fact, from));
						for (let i = 0; i < retries; i++) {
							r.reopen();
							expect(
								await r.run((s) => s.record(id, fact, {...from, sentAt: "2099-01-01T00:00:00Z"})),
							).toEqual(first);
						}
						expect((await r.all()).filter((e) => e.id === id)).toHaveLength(1);
						expect(await r.run((s) => s.current("counter"))).toMatchObject({
							id: req.id,
							code: req.code,
						});
						expect(await r.run((s) => s.current("unknown"))).toBeNull();
					} finally {
						r.close();
					}
				},
			),
			checks,
		);
	});
	it("outside hashes, ID alphabets and UUID version/variant are checked through Effect", async () => {
		const {CodeHash, EntryId} = await code();
		await fc.assert(
			fc.asyncProperty(fc.string(), fc.integer({min: 0, max: 63}), async (text, n) => {
				const valid = typeId("entry", n);
				expect(await Effect.runPromise(Schema.decodeUnknownEffect(EntryId)(valid))).toBe(valid);
				for (const bad of [text.slice(0, 20), "A".repeat(64), "g".repeat(64), "a".repeat(n)])
					await failure(Schema.decodeUnknownEffect(CodeHash)(bad));
				// Full 128-bit bad UUIDs: encoded bits have version 4 or variant 00.
				const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
				const encode = (bits: bigint) => {
					let rest = bits;
					let out = "";
					for (let i = 0; i < 26; i++) {
						out = alphabet[Number(rest & 31n)] + out;
						rest >>= 5n;
					}
					return `entry_${out}`;
				};
				for (const bits of [(4n << 76n) | (2n << 62n) | BigInt(n), (7n << 76n) | BigInt(n)])
					await failure(Schema.decodeUnknownEffect(EntryId)(encode(bits)));
				expect(await Effect.runPromise(Schema.decodeUnknownEffect(CodeHash)("a".repeat(64)))).toBe(
					"a".repeat(64),
				);
			}),
			checks,
		);
	});
});
