#!/usr/bin/env node
// `tsh`, the package's bin: tsh with fabrika's programs listed, the pipeline's. Installed, it
// runs the build (`dist/tsh.js`); in this repo `bin/tsh` runs this file from the source.
// `@kampus/fabrika`'s own bin is tsh with its small programs alone.
//
// fabrika's programs run agents (the Agent SDK, ACP) and send traces (OpenTelemetry). Those are
// optional peers of the package, so they are looked for here, before anything loads: one that is
// missing is one line saying what to install, not Node's stack trace from deep in an import.

// Node at the edge, before any Effect runtime: reading the package's own manifest.
import {readFileSync} from "node:fs";

/** What tsh with fabrika's programs imports, beyond the package's own dependencies. */
export const NEEDS = [
	"@anthropic-ai/claude-agent-sdk",
	"@agentclientprotocol/sdk",
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
	// package's latest, which can fall outside them. `src/` and `dist/` both sit one level down.
	const {peerDependencies: peers} = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	) as {peerDependencies: Record<string, string>};
	process.stderr.write(
		`tsh: fabrika's programs need ${missing.join(", ")}, not installed. Install: npm install ${missing.map((name) => `"${name}@${peers[name]}"`).join(" ")}\n`,
	);
	process.exitCode = 1;
} else {
	await import("./tsh/fabrika-main.ts");
}
