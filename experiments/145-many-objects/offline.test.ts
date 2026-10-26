import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, it} from "vitest";
import {offlineStart} from "./offline.ts";

const cacheDir = mkdtempSync(join(tmpdir(), "exp145-cache-"));
afterAll(() => rmSync(cacheDir, {recursive: true, force: true}));

describe("a start with the server out of reach", () => {
	it("restores from the copy, holds the new desk, and lands it once when the server is back", async () => {
		const r = await offlineStart({samples: 5, cacheDir});
		// The server came back where it was.
		expect(r.url.after).toBe(r.url.before);
		// Online: the copy caught up, and the desk came from the server.
		expect(r.online.fromServer).toEqual({from: "server", desk: r.desks.v2});
		// Offline: the last desk the copy had, marked stale; the move is held once, not written.
		expect(r.offline.fromCopy).toMatchObject({from: "copy", desk: r.desks.v2, stale: true});
		expect(r.offline.held).toBe(1);
		expect(r.offline.otherRows).toBe(0);
		// Back: the held desk landed once; sent again, it was answered `dup`.
		expect(r.back.flushed).toEqual({sent: 1, dup: 0});
		expect(r.back.again).toEqual({sent: 1, dup: 1});
		expect(r.back.saves).toBe(3);
		expect(r.back.fromServer).toEqual({from: "server", desk: r.desks.v3});
		expect(r.back.lastCopiedId).toBe("save-3");
	});
});
