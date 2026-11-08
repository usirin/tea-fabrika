// P8, next/. These are invented accepted saves, not evidence of a historical notes run.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {Mailbox} from "@kampus/libfabrika/coordination";
import {Entry, Ledger, valueFor} from "@kampus/libfabrika/data";
import {Effect, Layer, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";

const Save = Schema.Struct({
	note: Schema.String,
	base: Schema.Number,
	body: Schema.String,
	how: Schema.optionalKey(Schema.Literals(["pause", "leave", "done", "kept"])),
	from: Schema.optionalKey(Schema.Struct({note: Schema.String, version: Schema.Number})),
});
const Send = Schema.TaggedStruct("send", {
	m: Schema.Struct({type: Schema.Literal("save"), value: Save}),
});
const path = resolve(import.meta.dirname, "../../../../../fixtures/next/notes-letters.jsonl");
const raw: unknown[] = readFileSync(path, "utf8")
	.trimEnd()
	.split("\n")
	.map((s) => JSON.parse(s));
const decode = (rows: readonly unknown[]) =>
	rows.map((row) => {
		const entry = Schema.decodeUnknownSync(Entry)(row);
		Schema.decodeUnknownSync(Send)(valueFor(entry));
		return entry;
	});
const entries = decode(raw);
const saves = entries.map((e) => Schema.decodeUnknownSync(Send)(valueFor(e)).m.value);

// Independent expectations: do not calculate these from a product fold.
const bodies = [
	"# First\n\nSaved text.",
	"",
	"Second  \n\nשלום 🌱\n",
	"Copied second",
	"```html\n<script>unsafe()</script>\n```\n",
	"# Third\n\nسلام 🌍  \n\n```ts\nconst n = 3;\n```\n",
	"A new line\nwith two spaces  ",
	"Last B\n\n",
];
const checkShape = (rows: readonly unknown[]) => {
	const es = decode(rows);
	expect(es).toHaveLength(8);
	expect(es.map((e) => Schema.decodeUnknownSync(Send)(valueFor(e)).m.value.body)).toEqual(bodies);
	expect(es.map((e) => [e.pos, e.rev, e.seen, e.arrivedAt, e.sentAt])).toEqual([
		[1, 4, 3, 1000, "2026-11-08T10:00:08Z"],
		[2, 7, 4, 1001, "2026-11-08T10:00:07Z"],
		[3, 11, 7, 1002, "2026-11-08T10:00:06Z"],
		[4, 16, 11, 1003, "2026-11-08T10:00:05Z"],
		[5, 22, 16, 1004, "2026-11-08T10:00:04Z"],
		[6, 29, 22, 1005, "2026-11-08T10:00:03Z"],
		[7, 37, 29, 1006, "2026-11-08T10:00:02Z"],
		[8, 46, 37, 1007, "2026-11-08T10:00:01Z"],
	]);
	for (const [i, e] of es.entries()) {
		expect(e.id).toBe(`p8-0${i + 1}`);
		expect(e.by).toBe(i % 2 === 0 ? "SHA256:fixture-agent" : "SHA256:fixture-person");
		expect(e.for).toBe("fixture-person");
		expect(e.parent).toBe(`in-process_01jc9q4w7z3m8n5r2t6v0xkb4d-${i + 1}`);
		expect(e.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
		expect(e.build).toBe("p8-fixture-v1");
	}
};
const checkOrder = (rows: readonly Entry[], globalVersions = false) => {
	const versions = new Map<string, number>();
	const order: string[] = [];
	for (const [i, e] of rows.entries()) {
		const s = Schema.decodeUnknownSync(Send)(valueFor(e)).m.value;
		const version = globalVersions ? i + 1 : (versions.get(s.note) ?? 0) + 1;
		expect(s.base, `base of ${e.id}`).toBe(version - 1);
		versions.set(s.note, version);
		const prior = order.indexOf(s.note);
		if (prior !== -1) order.splice(prior, 1);
		order.unshift(s.note);
	}
	expect([...versions]).toEqual([
		["note-a", 3],
		["note-b", 5],
	]);
	expect(order).toEqual(["note-b", "note-a"]);
};

describe("P8 frozen saves", () => {
	it("fixture shape: decodes the current Entry and preserves the original bytes and metadata", () =>
		checkShape(raw));
	it("fixture order: versions belong to each note; arrival order decides the list", () =>
		checkOrder(entries));
	it("keeps how and from without inventing defaults", () => {
		expect(saves.map((s) => s.how)).toEqual([
			"pause",
			"leave",
			"done",
			"kept",
			undefined,
			undefined,
			undefined,
			undefined,
		]);
		expect(saves[3]?.from).toEqual({note: "note-a", version: 2});
		expect(saves[7]?.from).toEqual({note: "note-a", version: 3});
	});
	it("real Mailbox.read carries every stored field, and an after revision keeps the next position", async () => {
		// Only the storage reader is replaced. The real mailbox converts Entry into History.
		const storage = Layer.succeed(Ledger, {
			append: () => Effect.die("read-only saved fixture"),
			wait: () => Effect.die("read-only saved fixture"),
			read: (stream, after) =>
				Stream.fromIterable(entries.filter((e) => e.stream === stream && e.rev > after)),
		});
		const got = await Effect.runPromise(
			Mailbox.use((m) => Stream.runCollect(m.read("notes:1", 0))).pipe(
				Effect.provide(Mailbox.layer.pipe(Layer.provide(storage))),
			),
		);
		expect(got).toEqual(
			entries.map(({_tag, stream: _stream, body, ...metadata}) => ({
				...metadata,
				m: Schema.decodeUnknownSync(Schema.Struct({m: Schema.Unknown}))(body).m,
			})),
		);
		const later = await Effect.runPromise(
			Mailbox.use((m) => Stream.runCollect(m.read("notes:1", 16))).pipe(
				Effect.provide(Mailbox.layer.pipe(Layer.provide(storage))),
			),
		);
		expect(later.map((e) => [e.rev, e.pos])).toEqual([
			[22, 5],
			[29, 6],
			[37, 7],
			[46, 8],
		]);
	});
	for (const key of ["parent", "traceId", "seen", "build", "sentAt", "arrivedAt"])
		it(`plant fixture shape: missing ${key} fails decoding`, () => {
			const row = {...entries[0]};
			Reflect.deleteProperty(row, key);
			expect(() => checkShape([row, ...entries.slice(1)])).toThrow(/Missing key/);
		});
	it("plant fixture order: sorting by writer clock fails on the first reversed base", () => {
		expect(() => checkOrder([...entries].sort((a, b) => a.sentAt.localeCompare(b.sentAt)))).toThrow(
			/base of p8-08/,
		);
	});
	it("plant fixture order: counting versions across notes fails on B's first save", () => {
		expect(() => checkOrder(entries, true)).toThrow(/base of p8-02/);
	});
});
