import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

// The type scale means what its names say: --fs-body is 13px, in every window and popover. It was
// written in rem for a 16px root while the root was 14px, so every size drew 12.5% small and
// nothing failed (tracker ticket 108). No layout runs here, so this reads the stylesheet and
// computes each size as the browser does: a px size is itself, a rem size is that many roots.

const CSS = readFileSync(join(import.meta.dirname, "window.css"), "utf8");

/** Each innermost rule of a stylesheet: its selector and its declarations, comments gone. */
const rulesOf = (css: string) =>
	[...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
		([, selector = "", body = ""]) => ({
			selector: selector.trim().replace(/\s+/g, " "),
			says: new Map(
				body
					.split(";")
					.map((d) => d.split(":").map((s) => s.trim()))
					.filter((d): d is [string, string] => d.length === 2 && d[0] !== ""),
			),
		}),
	);

/** A font size in px, given the root's: `13px`, or `0.8125rem` against the root. */
const pxOf = (size: string, root: number): number => {
	const [, n = "", unit] = /^(\d*\.?\d+)(px|rem)$/.exec(size) ?? [];
	if (unit === "px") return Number(n);
	if (unit === "rem") return Number(n) * root;
	throw new Error(`not a size this test computes: ${size}`);
};

/** Each --fs-* token, computed against the root's own font size. */
const scaleOf = (css: string) => {
	const root = rulesOf(css).find((r) => r.selector === ":root");
	if (root === undefined) throw new Error("no :root rule");
	const rootSize = pxOf(root.says.get("font-size") ?? "16px", 16);
	return Object.fromEntries(
		[...root.says]
			.filter(([name]) => name.startsWith("--fs-"))
			.map(([name, value]) => [name.slice("--fs-".length), pxOf(value, rootSize)]),
	);
};

/** The declarations that name a rem, as `selector { name: value }`. */
const remsOf = (css: string) =>
	rulesOf(css).flatMap((r) =>
		[...r.says]
			.filter(([, value]) => /\d\s*rem\b/.test(value))
			.map(([name, value]) => `${r.selector} { ${name}: ${value} }`),
	);

describe("the type scale", () => {
	it("draws each size at the px its name says", () => {
		expect(scaleOf(CSS)).toEqual({title: 22, head: 15, body: 13, prose: 14, small: 12, micro: 11});
	});

	it("names no rem, so the root's size moves nothing on its own", () => {
		expect(remsOf(CSS)).toEqual([]);
	});

	it("catches the old fault: rem sizes for a 16px root, on a 14px root", () => {
		const old = ":root {\n\t--fs-body: 0.8125rem;\n\tfont-size: 14px;\n}\n";
		expect(scaleOf(old)).toEqual({body: 11.375});
		expect(remsOf(old)).toEqual([":root { --fs-body: 0.8125rem }"]);
	});
});
