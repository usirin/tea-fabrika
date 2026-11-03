import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";
import app from "../package.json" with {type: "json"};
import {launchOf} from "./launch.ts";

describe("the app's icon", () => {
	it("is a 1024 square with a clear background, as the Dock wants it", () => {
		const png = readFileSync(new URL("../icon/icon.png", import.meta.url));
		expect(png.subarray(1, 4).toString()).toBe("PNG");
		// IHDR: width, height, then bit depth and color type. 8-bit RGBA is what holds clear corners.
		expect(png.readUInt32BE(16)).toBe(1024);
		expect(png.readUInt32BE(20)).toBe(1024);
		expect([png[24], png[25]]).toEqual([8, 6]);
	});
});

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

// Electron names the owner's home after `productName`. A new value starts the owner on an empty
// home, and their tickets look gone.
describe("the owner's home", () => {
	it("keeps its folder name when the package is renamed", () => {
		expect(app.productName).toBe("@kampus/fabrika-app");
	});
});
