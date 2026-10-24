// Node edge: private deployment settings are generated outside the public checkout.
import {randomBytes} from "node:crypto";
import {mkdtemp, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {Schema} from "effect";

const Hex = Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/));
const Target = Schema.Struct({
	account: Hex,
	zone: Hex,
	origin: Schema.String,
	issuer: Schema.String,
	audience: Schema.String,
	emails: Schema.Array(Schema.String).check(Schema.isMinLength(2), Schema.isMaxLength(2)),
});
const file = process.argv[2];
if (!file) throw Error("Pass a private target JSON file.");
const target = Schema.decodeUnknownSync(Target)(JSON.parse(await readFile(resolve(file), "utf8")));
const origin = new URL(target.origin);
if (
	origin.origin !== target.origin ||
	origin.protocol !== "https:" ||
	new Set(target.emails).size !== 2
)
	throw Error("Use an exact HTTPS origin and two distinct owners.");
const directory = await mkdtemp(join(tmpdir(), "fabrika-deploy-"));
const name = `fabrika-desk-${randomBytes(4).toString("hex")}`;
const owners = Object.fromEntries(
	target.emails.map((email) => [email.toLowerCase(), randomBytes(16).toString("hex")]),
);
const config = {
	name,
	account_id: target.account,
	main: join(import.meta.dirname, "src/worker.ts"),
	compatibility_date: "2026-10-22",
	compatibility_flags: ["nodejs_compat"],
	workers_dev: false,
	preview_urls: false,
	routes: [{pattern: `${origin.hostname}/fabrika/*`, zone_id: target.zone}],
	vars: {FABRIKA_ORIGIN: target.origin, ACCESS_ISSUER: target.issuer, ACCESS_AUD: target.audience},
	containers: [
		{
			class_name: "Desk",
			scheduling_policy: "durable_object",
			images: {desk: {dockerfile: join(import.meta.dirname, "Dockerfile")}},
		},
	],
	durable_objects: {bindings: [{name: "DESKS", class_name: "Desk"}]},
	migrations: [{tag: "v1", new_sqlite_classes: ["Desk"]}],
	r2_buckets: [{binding: "BACKUPS", bucket_name: name}],
};
for (const [path, value] of Object.entries({
	"wrangler.json": config,
	"secrets.json": {FABRIKA_OWNERS: JSON.stringify(owners)},
	"connection.json": {
		directory,
		worker: name,
		bucket: name,
		url: `${target.origin}/fabrika/`,
		profile: "kampus-tuval",
	},
}))
	await writeFile(join(directory, path), `${JSON.stringify(value, null, 2)}\n`, {mode: 0o600});
console.log(
	JSON.stringify({directory, worker: name, url: `${target.origin}/fabrika/`, deployed: false}),
);
