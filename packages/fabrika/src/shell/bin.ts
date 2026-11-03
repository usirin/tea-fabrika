#!/usr/bin/env node
// tsh with the small programs alone (./small.ts): a shell with its own
// coreutils and nothing else. `@kampus/fabrika-old` installs no command: in this
// repo the dev script `packages/fabrika/bin/tsh-small` runs this file from the
// source. An app with programs of its own ships its own bin that hands tsh its
// list instead, as `@kampus/pipeline` does with `tsh`.
//
// tsh sends traces (OpenTelemetry), and those are optional peers of the
// package. So they are looked for here, before anything loads: one that is
// missing is one line saying what to install, not Node's stack trace from
// deep in an import.

// Node at the edge, before any Effect runtime: reading the package's own manifest.
import {readFileSync} from "node:fs";

/** What tsh imports, beyond the package's own dependencies. */
const NEEDS = [
	"@effect/opentelemetry",
	"@opentelemetry/api",
	"@opentelemetry/exporter-trace-otlp-http",
	"@opentelemetry/resources",
	"@opentelemetry/sdk-trace-base",
];

const installed = (name: string): boolean => {
	// Node at the edge, before any Effect runtime: `import.meta.resolve` throws on a missing package.
	try {
		import.meta.resolve(name);
		return true;
	} catch {
		return false;
	}
};

const missing = NEEDS.filter((name) => !installed(name));
if (missing.length > 0) {
	// The install line carries the package's own peer versions: a bare `npm install` takes each
	// package's latest, which can differ. `src/shell/` and `dist/shell/` both sit two levels down. In
	// this repo the manifest says `catalog:`, which npm cannot read, and `pnpm install` is the fix; a
	// pack holds the versions.
	const {peerDependencies: peers} = JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	) as {peerDependencies: Record<string, string>};
	const install = missing.some((name) => peers[name] === "catalog:")
		? "pnpm install"
		: `npm install ${missing.map((name) => `"${name}@${peers[name]}"`).join(" ")}`;
	process.stderr.write(
		`tsh: tsh needs ${missing.join(", ")}, not installed. Install: ${install}\n`,
	);
	process.exitCode = 1;
} else {
	const [{Effect}, {runTsh}, {Programs, programList}, {SMALL}] = await Promise.all([
		import("effect"),
		import("./main.ts"),
		import("./programs.ts"),
		import("./small.ts"),
	]);
	process.exitCode = await Effect.runPromise(
		runTsh().pipe(Effect.provideService(Programs, programList(SMALL))),
	);
}
