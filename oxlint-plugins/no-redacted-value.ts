// A secret leaves its `Redacted` only at the line that sends it out.
//
// Why: fabrika builds public repositories too (the owner's ruling of 2026-10-26,
// docs/direction/secrets-are-redacted.md). A secret travels as an Effect
// `Redacted.Redacted<string>`, which prints, logs, saves and serializes as
// `<redacted>`. `Redacted.value` gives the plain text back, and from then on
// nothing guards it. So it is called only in a short list of edge files, each
// of them where the secret goes out: a header or a socket's subprotocol, a
// one-way hash, a child's env, the locker file the secret is kept in, the wire
// answer of a login. `.oxlintrc.json` names those files, each with its reason, and
// turns this rule off for them.
//
// What it refuses, anywhere else: `Redacted.value`, called (`Redacted.value(t)`)
// or handed on as a function (`xs.map(Redacted.value)`). Tests are left out
// too: they hold made-up secrets and must read them back to check them.
//
// What it cannot see: `value` imported under its own name from
// "effect/Redacted", and a secret that never was a `Redacted`
// (no-secret-env.ts covers the env reads).
//
// This repo's own rule, not a copy. It blocks. Fires when it was
// added are in oxlint-plugins/README.md.
import type {CreateRule} from "@oxlint/plugins";
import {banNames} from "./match.ts";

export const noRedactedValue: CreateRule = {
	create: banNames({
		"Redacted.value":
			"`Redacted.value` turns a secret back into a plain string that prints, logs and saves as itself. Keep the `Redacted` until the line that sends it, in one of the edge files `.oxlintrc.json` lists for fabrika/no-redacted-value, with its reason (docs/direction/secrets-are-redacted.md).",
	}),
};
