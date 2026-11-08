// P18 inputs only. No keep, monitor, delivery or reconnect decisions live here.
import {Schema} from "effect";
import * as fc from "fast-check";
import {ProcessId} from "../data/trace.ts";
import type {ClientId, MonitorId} from "./protocol.ts";
import type {TileId} from "./protocol.ts";

const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
// UUIDv7: 48 clock bits, version 7, 12 random bits, variant 10, 62 random bits.
export const p18Suffix = fc
	.tuple(fc.bigInt({min: 0n, max: (1n << 48n) - 1n}), fc.bigInt({min: 0n, max: (1n << 74n) - 1n}))
	.map(([clock, entropy]) => {
		let bits =
			(clock << 80n) |
			(7n << 76n) |
			((entropy >> 62n) << 64n) |
			(2n << 62n) |
			(entropy & ((1n << 62n) - 1n));
		let text = "";
		for (let n = 0; n < 26; n++) {
			text = alphabet[Number(bits & 31n)] + text;
			bits >>= 5n;
		}
		return text;
	});

type Values = {
	readonly client: typeof ClientId.Type;
	readonly sessionA: typeof ProcessId.Type;
	readonly sessionB: typeof ProcessId.Type;
	readonly processA: typeof ProcessId.Type;
	readonly processB: typeof ProcessId.Type;
	readonly tileA: typeof TileId.Type;
	readonly tileB: typeof TileId.Type;
	readonly refA: typeof MonitorId.Type;
	readonly refB: typeof MonitorId.Type;
};

// Decode brands in the consuming test, after importing the real product schemas.
// This input module stays loadable while P14's schemas have not landed.
const client = Schema.String.pipe(Schema.brand("client"));
const monitor = Schema.String.pipe(Schema.brand("monitor"));
const tile = Schema.String.pipe(Schema.brand("tile"));
export const p18Ids: fc.Arbitrary<Values> = fc
	.uniqueArray(p18Suffix, {minLength: 9, maxLength: 9})
	.map((s) => ({
		client: client.make(`client_${s[0]}`),
		sessionA: ProcessId.make(`process_${s[1]}`),
		sessionB: ProcessId.make(`process_${s[2]}`),
		processA: ProcessId.make(`process_${s[3]}`),
		processB: ProcessId.make(`process_${s[4]}`),
		tileA: tile.make(`tile_${s[5]}`),
		tileB: tile.make(`tile_${s[6]}`),
		refA: monitor.make(`monitor_${s[7]}`),
		refB: monitor.make(`monitor_${s[8]}`),
	}));
const fixed = () => {
	const value = fc.sample(p18Ids, {seed: 119120, numRuns: 1})[0];
	if (value === undefined) throw new Error("P18 input generator returned no values");
	return value;
};
export const p18Values = fixed();
export const p18Reason = fc.oneof(
	fc.constantFrom("normal", "shutdown", "noproc", "crashed"),
	fc.string({minLength: 1, maxLength: 256}),
);
