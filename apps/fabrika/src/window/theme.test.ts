import fc from "fast-check";
// Today's app, T343 PR 1. Real ghostty renderer, with canvas calls recorded.
// Plant: check the default background; swap before inverse; apply faint after correction.
import {CanvasRenderer, CellFlags} from "ghostty-web";
import {describe, expect, it} from "vitest";
import {channels, composite, hex, rgbHex, RUNS, solid} from "../../../../fixtures/themes/laws.ts";

type Cell = {
	codepoint: number;
	width: number;
	flags: number;
	fg_r: number;
	fg_g: number;
	fg_b: number;
	bg_r: number;
	bg_g: number;
	bg_b: number;
	grapheme_len: number;
	hyperlink_id: number;
};
interface Renderer {
	ctx: {fillStyle: string; globalAlpha: number; font: string; fillText: () => void};
	theme: {background: string; selectionBackground: string; selectionForeground: string};
	metrics: {width: number; height: number; baseline: number};
	fontSize: number;
	fontFamily: string;
	isInSelection: () => boolean;
	correctForeground?: (fg: string, bg: string) => string;
	renderCellText: (cell: Cell, x: number, y: number) => void;
}

describe("T18 per-cell correction", () => {
	it("checks the final drawn foreground and background after selection, inverse and faint", () => {
		fc.assert(
			fc.property(
				fc.record({
					foreground: solid,
					background: solid,
					base: solid,
					selection: hex,
					selectedInk: solid,
					selected: fc.boolean(),
					inverse: fc.boolean(),
					faint: fc.boolean(),
					corrected: solid,
					emoji: fc.constantFrom(0x1f600, 0x1f1f9, 0x2764),
				}),
				(v) => {
					const before: [string, string][] = [],
						drawn: {color: string; alpha: number}[] = [];
					const renderer = Object.create(CanvasRenderer.prototype) as Renderer;
					renderer.theme = {
						background: v.base,
						selectionBackground: v.selection,
						selectionForeground: v.selectedInk,
					};
					renderer.metrics = {width: 8, height: 16, baseline: 12};
					renderer.fontSize = 13;
					renderer.fontFamily = "monospace";
					renderer.isInSelection = () => v.selected;
					renderer.ctx = {
						fillStyle: "",
						globalAlpha: 1,
						font: "",
						fillText: () => {
							drawn.push({color: renderer.ctx.fillStyle, alpha: renderer.ctx.globalAlpha});
						},
					};
					renderer.correctForeground = (fg, bg) => {
						before.push([fg, bg]);
						return v.corrected;
					};
					const [r, g, b] = channels(v.foreground),
						[R, G, B] = channels(v.background);
					const cell: Cell = {
						codepoint: 65,
						width: 1,
						flags: (v.inverse ? CellFlags.INVERSE : 0) | (v.faint ? CellFlags.FAINT : 0),
						fg_r: r!,
						fg_g: g!,
						fg_b: b!,
						bg_r: R!,
						bg_g: G!,
						bg_b: B!,
						grapheme_len: 0,
						hyperlink_id: 0,
					};
					const original = {...cell};
					const rawBg = v.inverse ? v.foreground : v.background;
					const bg = v.selected
						? composite(v.selection, v.base)
						: rawBg === "#000000"
							? v.base
							: rawBg;
					const rawFg = v.selected ? v.selectedInk : v.inverse ? v.background : v.foreground;
					const fg = v.faint
						? rgbHex(channels(rawFg).map((n, i) => (n + channels(bg)[i]!) / 2))
						: rawFg;
					renderer.renderCellText(cell, 0, 0);
					expect(before).toEqual([[fg, bg]]);
					expect(drawn).toEqual([{color: v.corrected, alpha: 1}]);
					expect(cell).toEqual(original);
					expect(renderer.theme).toEqual({
						background: v.base,
						selectionBackground: v.selection,
						selectionForeground: v.selectedInk,
					});
					// Native emoji and an absent callback retain ghostty-web 0.4.0's drawing.
					const native = v.selected
						? v.selectedInk
						: `rgb(${channels(v.inverse ? v.background : v.foreground).join(", ")})`;
					before.length = 0;
					drawn.length = 0;
					renderer.renderCellText({...cell, codepoint: v.emoji}, 0, 0);
					expect(before).toEqual([]);
					expect(drawn).toEqual([{color: native, alpha: v.faint ? 0.5 : 1}]);
					delete renderer.correctForeground;
					drawn.length = 0;
					renderer.renderCellText(cell, 0, 0);
					expect(drawn).toEqual([{color: native, alpha: v.faint ? 0.5 : 1}]);
				},
			),
			RUNS,
		);
	});
});
