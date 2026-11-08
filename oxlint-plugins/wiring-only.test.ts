// T293, next/. P14's test writer owns wiring-only.ts. Import it; do not supply a replacement.
import {describe, expect, it} from "vitest";
import {plant} from "../next/apps/fabrika/src/exam/plant.ts";

describe("P20 wiring and existing language rules", () => {
	it.each([
		[
			"decoder",
			'import {Schema} from "effect";\nexport const read = Schema.decodeUnknownEffect(Schema.String);',
		],
		["settings rule", "export const pause = (n: number) => n > 0 ? n : 1500;"],
		[
			"retry",
			"export const retry = (online: boolean, send: () => void) => { if (online) send(); };",
		],
	])("L31 app refuses the planted %s", async (_name, code) => {
		await import("./wiring-only.ts");
		const file = "next/apps/fabrika/src/entry/views.ts";
		expect(plant({[file]: code})("fabrika(wiring-only)", file).length).toBeGreaterThan(0);
	});
	it("L31 registrations and Layer wiring pass", async () => {
		await import("./wiring-only.ts");
		const file = "next/apps/fabrika/src/entry/views.ts";
		expect(
			plant({
				[file]:
					'import {notesWindow} from "@kampus/notes/window";\nexport const views = {notes: notesWindow};',
			})("fabrika(wiring-only)", file),
		).toEqual([]);
	});
	it.each([
		[
			"fabrika(no-promises)",
			"next/packages/libfabrika/src/client/note-editor.ts",
			"export const save = async () => 1;",
		],
		[
			"fabrika(no-hand-tag)",
			"next/packages/libfabrika/src/client/note-editor.ts",
			'export const saved = {_tag: "reading"};',
		],
		[
			"fabrika(one-store-hook)",
			"next/programs/notes/src/window.tsx",
			'import {useState} from "react";\nexport const NotesWindow = () => useState(0);',
		],
		[
			"fabrika(no-clock-in-view)",
			"next/programs/notes/src/window.tsx",
			"export const NotesWindow = () => Date.now();",
		],
	])("L32 planted %s fires on P20's actual paths", (rule, file, code) => {
		expect(plant({[file]: code})(rule, file).length).toBeGreaterThan(0);
	});
});
