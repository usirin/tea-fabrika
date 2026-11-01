import {expect, it} from "vitest";
import {slugify} from "./slug.ts";

it("p1: preserves letters with plain ASCII forms, including compatibility letters, ł, and ø", () => {
	const fixtures: Array<readonly [string, string]> = [
		["Çay Şeker", "cay-seker"],
		["Cafe\u0301 Society", "cafe-society"],
		["Łódź", "lodz"],
		["Smørrebrød", "smorrebrod"],
		["ł Ł ø Ø", "l-l-o-o"],
		["encyclopædia Œuvre", "encyclopaedia-oeuvre"],
		["Straße", "strasse"],
		["o\uFB03ce \uFB02owers", "office-flowers"],
		["Ｆｕｌｌ Ｗｉｄｔｈ", "full-width"],
	];

	for (const [title, expected] of fixtures) {
		expect(slugify(title), title).toBe(expected);
	}
});
