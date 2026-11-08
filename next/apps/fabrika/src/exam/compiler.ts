// The exam command and the build share one Compiler check in libfabrika.
import {globSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";
import {NodeRuntime} from "@effect/platform-node";
import {check, Row} from "@kampus/libfabrika/compiler";
import {Console, Effect, Schema} from "effect";

export {check, compile, Row, type Finding} from "@kampus/libfabrika/compiler";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");
class Unread extends Schema.TaggedError<Unread>()("Unread", {path: Schema.String}) {}
class Refused extends Schema.TaggedError<Refused>()("Refused", {findings: Schema.Number}) {}
const read = (path: string) =>
	Effect.try({try: () => readFileSync(join(ROOT, path), "utf8"), catch: () => new Unread({path})});
const lint = Effect.gen(function* () {
	const ledger = yield* read("compiler-ledger.json").pipe(
		Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Row)))),
	);
	const paths = globSync("next/**/*.tsx", {cwd: ROOT})
		.map((p) => relative(ROOT, join(ROOT, p)))
		.filter((p) => !p.includes("node_modules") && !p.includes(".test."))
		.sort();
	const files = new Map<string, string>();
	for (const path of paths) files.set(path, yield* read(path));
	const findings = check(files, ledger);
	for (const f of findings) yield* Console.error(`${f.file}:${f.line} ${f.fn}: ${f.why}`);
	yield* Console.log(
		`lint:compiler: ${files.size} files, ${findings.length} findings, ${ledger.length} ledger rows`,
	);
	if (findings.length > 0) return yield* new Refused({findings: findings.length});
});
if (import.meta.main) NodeRuntime.runMain(lint);
