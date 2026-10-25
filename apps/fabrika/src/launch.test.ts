import {describe, expect, it} from "vitest";
import {launchOf} from "./launch.ts";

// Which launch each environment asks for: a home of its own is quiet, unless asked otherwise.

describe("launchOf", () => {
	it("is the owner's with no home", () => {
		expect(launchOf({})).toEqual({kind: "owner"});
		expect(launchOf({FABRIKA_HOME: ""})).toEqual({kind: "owner"});
	});

	it("is quiet on a home of its own", () => {
		expect(launchOf({FABRIKA_HOME: "/tmp/h"})).toEqual({kind: "quiet", home: "/tmp/h"});
	});

	it("is in the foreground on a home only when asked with 1", () => {
		expect(launchOf({FABRIKA_HOME: "/tmp/h", FABRIKA_FOREGROUND: "1"})).toEqual({
			kind: "foreground",
			home: "/tmp/h",
		});
		expect(launchOf({FABRIKA_HOME: "/tmp/h", FABRIKA_FOREGROUND: "0"})).toEqual({
			kind: "quiet",
			home: "/tmp/h",
		});
	});

	it("needs a home to be in the foreground: the owner's start stays the owner's", () => {
		expect(launchOf({FABRIKA_FOREGROUND: "1"})).toEqual({kind: "owner"});
	});
});
