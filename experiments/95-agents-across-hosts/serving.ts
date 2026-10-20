// What a host hands a program it serves while it owns the program's name. The host's own
// machine (../94-tea-host/host-machine.ts, unchanged) turns this off when it stops owning.
import type {OnError} from "@demlik/tea";
import type {Effect} from "effect";
import type {Ledger} from "./client.ts";

export interface Serving {
	readonly ledger: Ledger["Service"];
	/** The registered name, `asker:1` or `answerer:1`. */
	readonly name: string;
	/** The fence of the claim this host won: every write the program makes carries it. */
	readonly fence: number;
	/** This host's name in the ledger, unique per process start. */
	readonly holder: string;
	/** One JSON line on stdout, for the harness. */
	readonly line: (o: object) => Effect.Effect<void>;
	/** Where the run's failures with no caller go (94: tea's default throws them and the host dies). */
	readonly onError: OnError;
	/** Say the program is running. */
	readonly started: Effect.Effect<void>;
}
