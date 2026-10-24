// Node edge: parse startup configuration once; the server receives concrete values.
import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {Effect, Schema} from "effect";
import {server} from "./server.ts";

const port = Schema.decodeUnknownSync(
	Schema.Int.check(Schema.isBetween({minimum: 1024, maximum: 65535})),
)(Number(process.env.FABRIKA_GUI_PORT ?? 5200));
const directory = resolve(process.env.FABRIKA_GUI_DATA ?? "../../runs/gui");
const bind = Schema.decodeUnknownSync(Schema.Literals(["127.0.0.1", "0.0.0.0"]))(
	process.env.FABRIKA_GUI_BIND ?? "127.0.0.1",
);
const origin = new URL(process.env.FABRIKA_GUI_ORIGIN ?? `http://127.0.0.1:${port}`).origin;
const path = Schema.decodeUnknownSync(
	Schema.String.check(Schema.isPattern(/^\/(?:[a-z0-9-]+\/)*$/)),
)(process.env.FABRIKA_GUI_PATH ?? "/");
const place = Schema.decodeUnknownSync(Schema.Literals(["local", "sandbox"]))(
	process.env.FABRIKA_GUI_PLACE ?? "local",
);
if (origin !== process.env.FABRIKA_GUI_ORIGIN && process.env.FABRIKA_GUI_ORIGIN !== undefined)
	throw new Error("Use an exact GUI origin without a path.");
if (!origin.startsWith("https://") && origin !== `http://127.0.0.1:${port}`)
	throw new Error("A remote desk needs HTTPS.");
await mkdir(directory, {recursive: true});
const env = Object.fromEntries(
	Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
const main = Effect.runPromise(
	server({
		port,
		bind,
		origin,
		path,
		place,
		database: resolve(directory, "desk.sqlite"),
		cwd: resolve(process.env.FABRIKA_GUI_CWD ?? "../.."),
		env,
	}),
);
main.catch((cause) => {
	console.error(String(cause));
	process.exitCode = 1;
});
