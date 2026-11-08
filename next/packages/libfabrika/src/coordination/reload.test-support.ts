// P15a, next/. Shared storage and wire fixtures. No app code or reload policy belongs here.
// Fixture assumption: release bytes are JSON {program, worker, window, runtime, files},
// with files sorted by path. The plan specifies the covered values but not their byte encoding.
import {createHash} from "node:crypto";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {Cause, Effect, Exit, Schema} from "effect";
import type {CodeBundle} from "../data/code.ts";
import type {Sql} from "../data/referee.ts";
import {nodeSql} from "../data/sqlite.ts";
import type {From} from "./mailbox.ts";

export const checks = {seed: 119120, numRuns: 24, endOnFailure: true};
export const from: From = {
	by: "SHA256:brain",
	for: "person_01j0000000e0080000000000001",
	sentAt: "2026-11-08T01:00:00Z",
	seen: 0,
	parent: null,
	traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
	build: "brain-build",
};
const hashBytes = (text: string) => createHash("sha256").update(text).digest("hex");

// TypeID's 128 bits: 48-bit timestamp, UUIDv7 version, 12 bits, RFC variant, 62 bits.
export const typeId = (prefix: string, n: number) => {
	const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
	let bits = (0x019000000000n << 80n) | (7n << 76n) | (2n << 62n) | BigInt(n + 1);
	let suffix = "";
	for (let i = 0; i < 26; i++) {
		suffix = alphabet[Number(bits & 31n)] + suffix;
		bits >>= 5n;
	}
	return `${prefix}_${suffix}`;
};
export const code = async () => import("../data/code.ts");
export const request = async (
	bundle: CodeBundle,
	n = 0,
	source: "watch" | "deploy" | "boot" | "restart" = "watch",
) => {
	const {RequestId} = await import("../data/id.ts");
	return {
		id: Schema.decodeUnknownSync(RequestId)(typeId("request", n)),
		program: bundle.program,
		code: {hash: bundle.hash, window: bundle.window},
		from: source,
	};
};
export const release = async (program: string, text: string): Promise<CodeBundle> => {
	const {CodeBundle} = await code();
	const files = [
		{path: "worker.js", source: `export const value = ${JSON.stringify(text)};`},
		{path: "window.js", source: `export const text = ${JSON.stringify(text)};`},
	];
	const manifest = {
		program,
		worker: "worker.js",
		window: hashBytes(files[1]!.source),
		runtime: hashBytes("shared-runtime"),
		files: [...files].sort((a, b) => a.path.localeCompare(b.path)),
	};
	return Schema.decodeUnknownSync(CodeBundle)({
		...manifest,
		hash: hashBytes(JSON.stringify(manifest)),
	});
};
export const disk = (folder: string, name: string) => {
	const path = join(folder, `${name}.db`);
	let db = new DatabaseSync(path);
	let inner = nodeSql(db);
	const fault = {
		query: (_q: string) => false,
		once: false,
		afterTransaction: false,
		rows: (_query: string, rows: ReturnType<Sql["exec"]>) => rows,
	};
	const sql: Sql = {
		exec: (query, ...values) => {
			if (fault.once && fault.query(query)) {
				fault.once = false;
				throw new Error("SQLITE_FULL");
			}
			return fault.rows(query, inner.exec(query, ...values));
		},
		transaction: (f) =>
			inner.transaction(() => {
				const value = f();
				if (fault.afterTransaction) {
					fault.afterTransaction = false;
					throw new Error("SQLITE_FULL");
				}
				return value;
			}),
		size: () => inner.size(),
	};
	return {
		sql,
		fault,
		db: () => db,
		reopen: () => {
			db.close();
			db = new DatabaseSync(path);
			inner = nodeSql(db);
		},
		close: () => {
			if (db.isOpen) db.close();
		},
	};
};
export const failure = async <A, E>(work: Effect.Effect<A, E>) => {
	const exit = await Effect.runPromiseExit(work);
	if (Exit.isSuccess(exit)) throw new Error("expected a typed failure, got success");
	if (Cause.hasDies(exit.cause)) throw new Error(`defect escaped: ${Cause.pretty(exit.cause)}`);
	return Cause.squash(exit.cause);
};
