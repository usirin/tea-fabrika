import {Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it} from "vitest";
import {Down, Recipient, signalId} from "../coordination/process.ts";
import {p18Ids, p18Reason} from "./tile.test-support.ts";

const options = {seed: 119120, numRuns: 100};
const keeps = fc.constantFrom("never", "failed", "always");
const oracle = (keep: string, why: string) =>
	keep === "always" || (keep === "failed" && why !== "normal" && why !== "shutdown");

describe("P18 W3", () => {
	it("every keep handles clean, failed, absent and unknown exits", async () => {
		const {keepTile} = await import("./tile.ts");
		fc.assert(
			fc.property(keeps, p18Reason, (keep, why) => {
				expect(keepTile(keep, why)).toBe(oracle(keep, why));
				// Each generated reason also crosses all three policies and the two clean reasons.
				for (const policy of ["never", "failed", "always"] as const)
					for (const reason of [why, "normal", "shutdown", "noproc"])
						expect(keepTile(policy, reason)).toBe(oracle(policy, reason));
			}),
			options,
		);
	});

	// Plants: discard the reason or ignore DOWN while the monitor acknowledgement is pending.
	it("finishes monitoring and live tiles once, retaining the exact reason and signal", async () => {
		const {TileState, Watch, finishTile} = await import("./tile.ts");
		const {ClientSession, MonitorId} = await import("./protocol.ts");
		fc.assert(
			fc.property(p18Ids, keeps, p18Reason, (ids, keep, why) => {
				const current = ClientSession.make({client: ids.client, session: ids.sessionA});
				const to = Recipient.cases.client.make(current);
				const ref = Schema.decodeUnknownSync(MonitorId)(ids.refA);
				const down = {
					id: signalId(to, ref, 1),
					rev: 42,
					pos: 1,
					arrivedAt: 10,
					m: Down.make({ref, process: ids.processA, why, to}),
				};
				const watch = Watch.make({pid: ids.processA, ref, to: current, dial: 1});
				for (const before of [
					TileState.cases.monitoring.make({watch}),
					TileState.cases.live.make({watch}),
				]) {
					const after = finishTile(before, keep, current, down);
					expect(after).toEqual({
						_tag: oracle(keep, why) ? "kept" : "closed",
						pid: ids.processA,
						why,
						signal: down.id,
					});
					expect(finishTile(after, keep, current, down)).toBe(after);
				}
			}),
			options,
		);
	});

	// Plants: compare only client, or remove the target/ref check.
	it("mismatched target, ref, client and session preserve the original object", async () => {
		const {TileState, Watch, finishTile} = await import("./tile.ts");
		const {ClientSession, MonitorId} = await import("./protocol.ts");
		fc.assert(
			fc.property(p18Ids, keeps, (ids, keep) => {
				const current = ClientSession.make({client: ids.client, session: ids.sessionA});
				const ref = Schema.decodeUnknownSync(MonitorId)(ids.refA);
				const before = TileState.cases.live.make({
					watch: Watch.make({pid: ids.processA, ref, to: current, dial: 8}),
				});
				const to = Recipient.cases.client.make(current);
				const m = Down.make({ref, process: ids.processA, why: "crashed", to});
				for (const bad of [
					{...m, ref: ids.refB},
					{...m, process: ids.processB},
					{...m, to: Recipient.cases.client.make({...current, session: ids.sessionB})},
					{...m, to: Recipient.cases.client.make({...current, client: `other_${ids.client}`})},
				])
					expect(
						finishTile(before, keep, current, {
							id: signalId(bad.to, bad.ref, 1),
							rev: 42,
							pos: 1,
							arrivedAt: 10,
							m: bad,
						}),
					).toBe(before);
				const otherSession = ClientSession.make({...current, session: ids.sessionB});
				expect(
					finishTile(before, keep, otherSession, {
						id: signalId(to, ref, 1),
						rev: 42,
						pos: 1,
						arrivedAt: 10,
						m,
					}),
				).toBe(before);
			}),
			options,
		);
	});

	// Plants run without importing absent P18 code; each uses the same observable expectation.
	it("plants: keep-everything, discard-failure, and losing the original reason are caught", () => {
		for (const wrong of [
			() => true,
			() => false,
			(keep: string, why: string) => oracle(keep, why === "shutdown" ? "crashed" : why),
		]) {
			expect(() =>
				fc.assert(
					fc.property(keeps, p18Reason, (keep, why) => wrong(keep, why) === oracle(keep, why)),
					options,
				),
			).toThrow();
		}
	});
});
