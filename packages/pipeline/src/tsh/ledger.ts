// tsh's ledger: the Durable Object, in Miniflare, on this machine (fabrika's host/local.ts). Each
// tsh starts it and stops it when it closes; one killed with no chance to close takes it down too
// (the ledger stops when its parent is gone, fabrika's host/daemon.ts). Its data is under the fabrika home,
// one object per repository by name, on a port made from the data folder: two ledgers never serve
// one folder, because the second cannot take the port.
//
// One tsh per fabrika home at a time. A second one, while the first runs, is refused and says so:
// it does not share the first one's ledger, which would stop under it when the first closes.
//
// node:sqlite stays the way out (docs/direction/a-local-first-sync-engine.md): `sqliteLedger` is
// the same `Ledger` on a file, kept for when the Durable Object fails us. Which one tsh uses is
// the repository's pick, `[ledger] at` in its fabrika.toml (`local`, this one, when left out),
// printed at start (../setup.ts); never tsh.toml's, so two machines on one repository pick alike.

import {Ledger} from "@kampus/fabrika-old";
// A ledger answers on a port: its door answers even a request with no credential.
import {answers} from "@kampus/fabrika-old/http";
import {layerLocal} from "@kampus/fabrika-old/local";
import {layerSqlite} from "@kampus/fabrika-old/sqlite";
import {Duration, Effect, Layer, Schedule, Schema} from "effect";

/**
 * The ledger's port for a data folder: the same folder, the same port, from 12000 to 31999.
 *
 * Below 32768, where Linux starts giving out the local ports of outgoing connections (macOS and
 * Windows start at 49152). A fixed port inside that range can be held at any moment by any
 * connection on the machine, and on Linux the ledger then cannot listen on it. The range was 40000
 * to 59999 until CI hit that, twice.
 */
export const portOf = (persist: string): number => {
	// FNV-1a, 32 bits: a fixed spread of folder names over the range, nothing secret.
	let h = 0x811c9dc5;
	for (let i = 0; i < persist.length; i++) h = Math.imul(h ^ persist.charCodeAt(i), 0x01000193);
	return 12_000 + ((h >>> 0) % 20_000);
};

/** A ledger's name as the Durable Object's URL takes it: lower-case letters, digits and dashes. */
export const ledgerNameOf = (text: string) =>
	text
		.toLowerCase()
		.replace(/\.sqlite$/, "")
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/^-+|-+$/g, "");

/** Another tsh holds this home's ledger, or it would not start. */
export class NoLocalLedger extends Schema.TaggedError<NoLocalLedger>()("NoLocalLedger", {
	message: Schema.String,
}) {}

/**
 * The `Ledger` for one repository's name, on a ledger this tsh starts and stops. A ledger left
 * by a tsh that was killed stops on its own within a second: it is waited out, up to `waitMs`.
 */
export const localLedger = (o: {
	readonly persist: string;
	readonly ledger: string;
	readonly port?: number;
	readonly waitMs?: number;
}): Layer.Layer<Ledger, unknown> => {
	const port = o.port ?? portOf(o.persist);
	const url = `http://127.0.0.1:${port}`;
	const free = answers(url).pipe(
		Effect.repeat({
			until: (up) => !up,
			schedule: Schedule.spaced(Duration.millis(200)),
		}),
		Effect.timeoutOrElse({
			duration: Duration.millis(o.waitMs ?? 5_000),
			orElse: () =>
				Effect.fail(
					new NoLocalLedger({
						message: `another tsh is using the ledger in ${o.persist} (port ${port})`,
					}),
				),
		}),
	);
	const started = Layer.effect(Ledger, Effect.service(Ledger)).pipe(
		Layer.provide(layerLocal({persist: o.persist, ledger: o.ledger, port})),
	);
	return Layer.unwrap(free.pipe(Effect.as(started)));
};

/** The way out: the same `Ledger` on a node:sqlite file. */
export const sqliteLedger = (file: string) => layerSqlite({path: file});
