#!/usr/bin/env node
// tsh with the small programs alone (./small.ts): a shell with its own
// coreutils and nothing else. `@kampus/fabrika`'s bin: installed, it runs the
// build (`dist/shell/bin.js`); in this repo `bin/tsh` runs this file from the
// source. An app with programs of its own ships its own bin that hands tsh its
// list instead, as `@kampus/pipeline` does.
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
	// The install line carries the package's own peer ranges: a bare `npm install` takes each
	// package's latest, which can fall outside them. `src/shell/` and `dist/shell/` both sit two
	// levels down.
	const {peerDependencies: peers} = JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	) as {peerDependencies: Record<string, string>};
	process.stderr.write(
		`tsh: tsh needs ${missing.join(", ")}, not installed. Install: npm install ${missing.map((name) => `"${name}@${peers[name]}"`).join(" ")}\n`,
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
