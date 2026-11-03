#!/usr/bin/env node
// `tsh`, the package's bin: tsh with fabrika's programs listed, the pipeline's. Installed, it
// runs the build (`dist/tsh.js`); in this repo `bin/tsh` runs this file from the source.
// `@kampus/fabrika-old` installs no command, so this is the one `tsh` (experiment 114).
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
	// The install line carries the package's own peer versions: a bare `npm install` takes each
	// package's latest, which can differ. `src/` and `dist/` both sit one level down. In this repo the
	// manifest says `catalog:`, which npm cannot read, and `pnpm install` is the fix; a pack holds the
	// versions.
	const {peerDependencies: peers} = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	) as {peerDependencies: Record<string, string>};
	const install = missing.some((name) => peers[name] === "catalog:")
		? "pnpm install"
		: `npm install ${missing.map((name) => `"${name}@${peers[name]}"`).join(" ")}`;
	process.stderr.write(
		`tsh: fabrika's programs need ${missing.join(", ")}, not installed. Install: ${install}\n`,
	);
	process.exitCode = 1;
} else {
	await import("./tsh/fabrika-main.ts");
}
