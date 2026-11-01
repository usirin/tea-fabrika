// A secret is never read from `process.env` as a plain string.
//
// Why: fabrika builds public repositories too (the owner's ruling of 2026-10-26,
// docs/direction/secrets-are-redacted.md). A plain string prints, logs, saves and
// serializes as itself, so one `console.log`, one error message or one span
// attribute puts the secret in a public log. Read it with Effect's
// `Config.Redacted("NAME")` instead: the value is an Effect `Redacted`, which
// prints `<redacted>` everywhere, and `Redacted.value` takes it out only at the
// line that sends it (no-redacted-value.ts says where that may be).
//
// What it refuses: `process.env.NAME` and `process.env["NAME"]`, and
// `const {NAME} = process.env`, where NAME has one of these words between
// underscores: TOKEN, SECRET, PASSWORD, PASSWD, AUTH, CREDENTIAL, CREDENTIALS,
// or a key: API_KEY, APIKEY, PRIVATE_KEY, SECRET_KEY, ACCESS_KEY, SIGNING_KEY.
// So `GITHUB_TOKEN`, `TYPESAFE_API_KEY`, `DOOR_SECRET` and
// `CLAUDE_CODE_OAUTH_TOKEN` are refused, and `KEYS_CACHE_MS`, `GIT_AUTHOR_NAME`
// and `MONKEY` are not.
//
// Left alone, because they read no secret (each was a false alarm when the rule
// was first counted, see README.md):
//   - a bare KEY (`process.env.KEY`, `REAL_KEY`): in this repo a key of a results
//     table or a cache, not a secret;
//   - a name that ends in `_HASH`: a one-way hash of a secret may be plain text;
//   - a name that ends in `_SOCK` (`SSH_AUTH_SOCK`): a socket's path, not a key;
//   - `delete process.env.NAME`: it takes the secret away;
//   - a write, `process.env.NAME = "x"`: it reads nothing;
//   - a check that it is set: `!process.env.NAME`, `process.env.NAME === undefined`
//     and `!== undefined`. The value goes nowhere but a yes or a no.
//
// What it cannot see: a name it is not given (`process.env[name]`), a whole
// environment handed on (`{...process.env}`, the keep-lists of
// agents/claude/env.ts), a Worker's `env.GITHUB_TOKEN`, a `process?.env.NAME`, and a
// secret named without one of these words. A rename to drop a key on purpose
// (`const {TYPESAFE_API_KEY: _gone, ...env} = process.env`) is left alone: it
// reads nothing. So is `const {NAME = "x"} = process.env`, unless the name goes on past
// the word (`NAME_X = "x"`): the old rule read the whole `NAME = "x"` as the name.
//
// This repo's own rule, not a copy. It blocks. Its fires when it was
// added are in oxlint-plugins/README.md.
import type {CreateRule} from "@oxlint/plugins";
import {below, dotted, grouped, isWritten, type Node, quoted} from "./match.ts";

const SECRET =
	/^(?:.*_)?(?:(?:API|PRIVATE|SECRET|ACCESS|SIGNING)_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIALS?)(?:_.*)?$/;
const NOT_SECRET = /^.*_(?:HASH|SOCK)$/;
const isSecret = (name: string): boolean => SECRET.test(name) && !NOT_SECRET.test(name);

const READ =
	"A secret read from `process.env` is a plain string: it prints, logs and saves as itself. Read it with `Config.Redacted('NAME')` (effect), so it stays `<redacted>` until the one line that sends it (docs/direction/secrets-are-redacted.md).";

export const noSecretEnv: CreateRule = {
	create(context) {
		const source = context.sourceCode;
		/** `!x`, `delete x`, `x === undefined` and the like: an answer of yes or no, or a removal. */
		const onlyAsksIfSet = (node: Node & {readonly parent: Node}): boolean => {
			if (grouped(source, node) > 0) return false;
			const {parent} = node;
			if (parent.type === "UnaryExpression") {
				return parent.operator === "!" || parent.operator === "delete";
			}
			if (parent.type !== "BinaryExpression") return false;
			if (parent.operator !== "===" && parent.operator !== "!==") return false;
			const other = parent.left === node ? parent.right : parent.left;
			return (
				other.type === "Identifier" && other.name === "undefined" && grouped(source, other) === 0
			);
		};
		return {
			MemberExpression(node) {
				const isEnv = dotted(node.object) === "process.env";
				if (!isEnv || isWritten(node)) return;
				let name: string | null = null;
				if (!node.computed && !node.optional && node.property.type === "Identifier") {
					name = node.property.name;
				} else if (node.computed) {
					const raw = quoted(node.property);
					name = raw === null ? null : raw.slice(1, -1);
				}
				if (name === null || !isSecret(name) || onlyAsksIfSet(node)) return;
				context.report({node, message: READ});
			},
			VariableDeclarator(node) {
				if (node.init == null) return;
				const secret = [...below(node.id)].some(
					(part) =>
						part.type === "Property" &&
						part.shorthand &&
						part.parent.type === "ObjectPattern" &&
						isSecret(source.getText(part)),
				);
				if (!secret) return;
				const reads = [...below(node.init)].some((part) => dotted(part) === "process.env");
				if (!reads) return;
				context.report({
					node: node.id,
					message:
						"A secret taken out of `process.env` by name is a plain string: it prints, logs and saves as itself. Read it with `Config.Redacted('NAME')` (effect) (docs/direction/secrets-are-redacted.md).",
				});
			},
		};
	},
};
