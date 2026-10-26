// Question 4: the laptop's read copy of a person's own object, for a start while the server is
// out of reach. A cache, never a second ledger:
//
//   - its rows are only rows the server sent, with the server's own pos and rev; it makes none;
//   - it answers reads only, and says how old it is (`stale`, `asOf`);
//   - a write made while the server is out of reach is not a row: it is held, under its message
//     id, outside the copy, until the server takes it. A held write sent twice lands once;
//   - it names the server it copies. A copy of another server is no copy (LiveStore's
//     `backendId` check does the same).
//
// Like git's `origin/main`: what the remote said last, kept to read, never pushed to.
//
// The copy is one JSON file, written whole to a new file and renamed over the old one.
import {Ledger, Rows} from "@kampus/fabrika";
import {Effect, FileSystem, Path, Schema} from "effect";
import {openDesk, SAVED, Saved, savedOf} from "./desk.ts";

const Copy = Schema.Struct({
	server: Schema.String,
	object: Schema.String,
	/** The last pos copied. */
	pos: Schema.Number,
	/** When the copy last heard from the server. */
	at: Schema.Number,
	rows: Rows,
});
type Copy = typeof Copy.Type;

/** A desk saved while the server was out of reach: its message id and the desk. */
const HeldSave = Schema.Struct({id: Schema.String, desk: Saved});
const Held = Schema.Array(HeldSave);
type Held = typeof Held.Type;

/** Where a desk came from at a start. */
export type Restored =
	| {readonly from: "server"; readonly desk: Saved | null}
	| {
			readonly from: "copy";
			readonly desk: Saved | null;
			readonly stale: true;
			readonly asOf: number;
	  };

const decodeCopy = Schema.decodeUnknownEffect(Schema.fromJsonString(Copy));
const decodeHeld = Schema.decodeUnknownEffect(Schema.fromJsonString(Held));

export const openCopy = (dir: string, server: string, object: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const base = object.replace("/", "-");
		const copyFile = path.join(dir, `${base}.copy.json`);
		const heldFile = path.join(dir, `${base}.held.json`);

		const writeWhole = (file: string, text: string) =>
			fs.writeFileString(`${file}.new`, text).pipe(Effect.andThen(fs.rename(`${file}.new`, file)));
		const empty: Copy = {server, object, pos: 0, at: 0, rows: []};
		const load = fs.readFileString(copyFile).pipe(
			Effect.flatMap(decodeCopy),
			// A copy of another server, or of another object, is no copy.
			Effect.map((c) => (c.server === server && c.object === object ? c : empty)),
			Effect.orElseSucceed(() => empty),
		);
		const loadHeld = fs.readFileString(heldFile).pipe(
			Effect.flatMap(decodeHeld),
			Effect.orElseSucceed((): Held => []),
		);

		/** Read what the server has past the copy's last pos, page by page, and keep it. */
		const catchUp = Effect.gen(function* () {
			const l = yield* Ledger;
			const copy = yield* load;
			const rows = [...copy.rows];
			let pos = copy.pos;
			for (;;) {
				const page = yield* l.read(pos, 500);
				rows.push(...page);
				pos = page.at(-1)?.pos ?? pos;
				if (page.length < 500) break;
			}
			const next: Copy = {server, object, pos, at: Date.now(), rows};
			yield* writeWhole(copyFile, JSON.stringify(next));
			return {rows: rows.length - copy.rows.length, pos};
		});

		/** The desk at a start: from the server when it answers, else from the copy, marked stale. */
		const restore = Effect.gen(function* () {
			const l = yield* Ledger;
			const last = yield* l.readLast(SAVED, 1).pipe(Effect.result);
			if (last._tag === "Success")
				return {from: "server", desk: yield* savedOf(last.success[0])} satisfies Restored;
			const copy = yield* load;
			const row = copy.rows.findLast((r) => r.stream === SAVED);
			const desk = yield* savedOf(row);
			return {from: "copy", desk, stale: true, asOf: copy.at} satisfies Restored;
		});

		/** A desk saved while out of reach: held under its id, never put in the copy. */
		const hold = (id: string, desk: Saved) =>
			Effect.gen(function* () {
				const held = yield* loadHeld;
				if (held.some((h) => h.id === id)) return;
				yield* writeWhole(heldFile, JSON.stringify([...held, {id, desk}]));
			});

		/**
		 * Send every held desk, in order, under its id, then forget it. A crash between the send
		 * and the forget sends it again: the ledger answers `dup`, and it lands once.
		 */
		const flush = (holder: string, ttlMs?: number) =>
			Effect.gen(function* () {
				const held = yield* loadHeld;
				if (held.length === 0) return {sent: 0, dup: 0};
				const d = yield* openDesk(holder, ttlMs);
				let dup = 0;
				for (const [i, h] of held.entries()) {
					const r = yield* d.save(h.desk, h.id);
					if (r.dup) dup++;
					yield* writeWhole(heldFile, JSON.stringify(held.slice(i + 1)));
				}
				return {sent: held.length, dup};
			});

		return {
			load,
			held: loadHeld,
			catchUp,
			restore,
			hold,
			flush,
			files: {copy: copyFile, held: heldFile},
		};
	});
