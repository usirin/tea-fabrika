// P15a, next/. Tests owns this CLI; build owns the reusable Node-only implementation.
import {resolve} from "node:path";
import {NodeRuntime} from "@effect/platform-node";
import {lint} from "@kampus/libfabrika/build";
export {check, compile, type Finding, type Row} from "@kampus/libfabrika/build";
if (import.meta.main)
	NodeRuntime.runMain(lint({root: resolve(import.meta.dirname, "../../../../..")}));
