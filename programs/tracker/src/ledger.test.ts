import {DOOR, Ledger, MEMBERS, streams} from "@kampus/fabrika-old";
import {memoryService} from "@kampus/fabrika-old/memory";
import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {loadCell} from "./ledger.ts";
import type {load} from "./machine.ts";
import {rowsOf} from "./rows.ts";

// The tracker's read names an agent's person from the ledger's members (`door/members`), the
// facts the door writes as people come. Here they are written by hand, on a ledger in memory.

describe("loading the tickets", () => {
	it("names the person an agent works for, and leaves a row from before the door alone", async () => {
		const ledger = memoryService();
		const entries = await Effect.runPromise(
			Effect.gen(function* () {
				// The door's stream is its own name's; on a ledger with no door, a claim writes it.
				const reg = yield* ledger.register(DOOR, "ledger");
				const {fence} = yield* ledger.claim(DOOR, "test", reg.rev, 60_000);
				yield* ledger.append(
					MEMBERS,
					"any",
					{kind: "founded", writer: "user:github:7", data: {id: "github:7", name: "alice"}},
					fence,
				);
				yield* ledger.register("tracker/ticket/1", "user:github:7");
				const inbox = streams("tracker/ticket/1").inbox;
				yield* ledger.send(inbox, "w1", {
					kind: "filed",
					writer: "user:github:7",
					data: {type: "filed", title: "Login fails", body: ""},
				});
				yield* ledger.send(inbox, "w2", {
					kind: "commented",
					writer: "agent:old-host for:github:7",
					data: {type: "commented", body: "Found it."},
				});
				yield* ledger.send(inbox, "w3", {
					kind: "commented",
					writer: "agent:review",
					data: {type: "commented", body: "Me too."},
				});
				const cmd = {after: 0} as ReturnType<typeof load>;
				return (yield* loadCell(cmd)).entries;
			}).pipe(Effect.provideService(Ledger, ledger)),
		);
		expect(entries.map((e) => [e.by.id, e.whose])).toEqual([
			["github:7", undefined],
			["old-host", "alice"],
			["review", undefined],
		]);
		// The rows the window draws carry the name on.
		expect(rowsOf(entries).map((r) => r.whose)).toEqual([undefined, "alice", undefined]);
	});
});
