// Test writer can run the app's new tests before the builder adds its public package imports.
// These aliases resolve real services, with no substitute implementation.
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {mergeConfig} from "vitest/config";
import base from "../../../vitest.config.ts";

const fromLibrary = createRequire(
	new URL("../../../next/packages/libfabrika/package.json", import.meta.url),
);
const source = (path: string) =>
	fileURLToPath(new URL(`../../../next/packages/libfabrika/src/${path}`, import.meta.url));

export default mergeConfig(base, {
	test: {includeTaskLocation: true},
	resolve: {
		alias: {
			"@effect/vitest": fromLibrary.resolve("@effect/vitest"),
			"@kampus/libfabrika/access/Access": source("access/Access.ts"),
			"@kampus/libfabrika/access/ClientManager": source("access/ClientManager.ts"),
			"@kampus/libfabrika/access/SessionManager": source("access/SessionManager.ts"),
			"@kampus/libfabrika/access/Text": source("access/Text.ts"),
			"@kampus/libfabrika/gateway/Gateway": source("gateway/Gateway.ts"),
			"@kampus/libfabrika/ledger/Ledger": source("ledger/Ledger.ts"),
			"@kampus/libfabrika/ledger/LedgerTransaction": source("ledger/LedgerTransaction.ts"),
			"@kampus/libfabrika/ledger/Log": source("ledger/Log.ts"),
			"@kampus/libfabrika/processes/Mailbox": source("processes/Mailbox.ts"),
			"@kampus/libfabrika/processes/Process": source("processes/Process.ts"),
			"@kampus/libfabrika/processes/ProcessIdGenerator": source("processes/ProcessIdGenerator.ts"),
			"@kampus/libfabrika/processes/ProcessManager": source("processes/ProcessManager.ts"),
			"@kampus/libfabrika/telemetry/Archive": source("telemetry/Archive.ts"),
			"@kampus/libfabrika/telemetry/Records": source("telemetry/Records.ts"),
			"@kampus/libfabrika/telemetry/Sink": source("telemetry/Sink.ts"),
			"@kampus/libfabrika/telemetry/Trace": source("telemetry/Trace.ts"),
			"@kampus/libfabrika/transport/Sshsig": source("transport/Sshsig.ts"),
			"@kampus/libfabrika/transport/Wire": source("transport/Wire.ts"),
			"@kampus/libfabrika/sqlite": source("ledger/NodeSqlite.ts"),
		},
	},
});
