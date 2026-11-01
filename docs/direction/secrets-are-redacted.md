# Secrets are Redacted, from the read to the one line that sends them

Decided 2026-10-26 by the owner.

```ts
import {Config, Effect, Redacted} from "effect";

// Read: never a plain string. An empty or missing value is none.
const key = yield* Config.Redacted("TYPESAFE_API_KEY");     // Redacted<string>

// Travel: through services, errors, logs and spans, it prints as <redacted>.
yield* Effect.log("calling Jev with", key);                  // "calling Jev with <redacted>"
JSON.stringify({key});                                       // '{"key":"<redacted>"}'

// Leave: only at the edge, in a file .oxlintrc.json lists.
headers.authorization = `Bearer ${Redacted.value(key)}`;     // the one line
```

## Changed 2026-10-28: a state holds a secret's name, never the secret

Decided by the owner. Part B
([#171](https://github.com/usirin/tea-fabrika/pull/171)) found that no Effect
encoding both hides a `Redacted` and reads it back, so every storage now
refuses to save a state that holds one. That stays. What it guards against is
said more exactly here:

- **Keys in the owner's own Cloudflare account are fine.** It is like a key
  given to a hosted service the owner trusts. "Public repositories" below is
  not the main reason.
- **The shared record is not fine.** A job's record
  ([a JobRecord holds its trace](./a-job-record-holds-its-trace.md)) is read
  by everyone in the project, including people invited later, and nothing in
  it is ever deleted. A key in a step would be readable by any future member,
  forever, and still there after the key is rotated.
- **Copies leave.** Agents copy step and trace data into `experiments/results/`
  and `field/`, which are public.

```ts
// A sketch. The state keeps a name; a Cmd asks for the key when it needs it.
type State = { model: "opus"; key: { secret: "anthropic" } };
const key = yield* (yield* Secrets).get("anthropic"); // Redacted<string>
```

- **Each person's keys live in their own ledger object,** the one per person
  that sits beside the project's
  ([the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md)).
  Only that person reads them. The laptop twin is Miniflare.
- **Encrypting saved state was weighed and dropped.** It is Temporal's payload
  codec: a project key that every host needs, that is rotated with a keyring
  because nothing is deleted, and that loses every record if lost. No need we
  have pays for that.
- **Not now:** lending one key to another member. A "share this key" step can
  come when a shared paid account needs it.
- **How sure: 85%.** The doubt: a token that changes often, such as a login's,
  needs `set` as well as `get`. The service has both.

## What was decided

- **fabrika will build public repositories too.** A log, a trace, an error
  message, a saved state or a pull request comment may then be read by anyone.
  So a secret must not be able to reach one by accident.
- **Every secret is an Effect `Redacted` from the moment it is read.**
  - Read it with `Config.Redacted("NAME")`, or wrap it at the read with
    `Redacted.make` where the value comes from somewhere else (a request's
    `Authorization` header, a Worker binding, a file).
  - It travels as `Redacted.Redacted<string>`: a service's input, a Layer's
    option, a field of an error.
  - A schema keeps it as `Schema.Redacted(Schema.String)`, or for a value read
    off the wire, `Schema.RedactedFromValue(Schema.String, {disallowEncode: true})`,
    so encoding fails rather than write the text.
  - `Redacted.value` appears only on the line that sends it out: a header, a
    socket's subprotocol, a child's env, the locker file it is kept in, a
    login's answer to the one who logged in.
  - A one-way hash of a secret (SHA-256) may be a plain string.
- **Code and a lint rule hold this, not a note.** A written rule does not
  protect anything here ([make the mistake impossible](./make-the-mistake-impossible.md)).

## How it is held

The types do most of it. A `Redacted` is not a string, so a secret cannot be
passed where text is asked for without a `Redacted.value`, and Effect's own
`toString`, `toJSON` and Node's inspect all answer `<redacted>`.

```ts
// The door (packages/fabrika/src/host/door.ts), after this change.
export const newToken = (prefix: string): Redacted.Redacted<string> => ...;
export const hashOf = (token: Redacted.Redacted<string>): Promise<string> => ...; // the hash is plain
export type LoginAnswer = {token: Redacted.Redacted<string>; who: Stamp; expires: number};
async who(token: Redacted.Redacted<string> | null): Promise<Let<Stamp>>

// The Durable Object (durable-object.ts) wraps the bearer at the read,
const bearer = said === null ? null : Redacted.make(said);
// and a login's answer goes out through one helper. Through the plain `answer`
// it would say "<redacted>", so a slip breaks the login, and a test sees it.
const session = (r) => Response.json({...r.value, token: Redacted.value(r.value.token)});
```

Two lint rules, both blocking (`oxlint-plugins/README.md` has their counts):

| Rule | Refuses | Left out |
|---|---|---|
| `no-secret-env.ts` | `process.env.NAME`, `process.env["NAME"]` and `const {NAME} = process.env`, where NAME has TOKEN, SECRET, PASSWORD, AUTH, CREDENTIAL or an API, PRIVATE, SECRET, ACCESS or SIGNING KEY in it | a check that it is set, a `delete`, a name ending in `_HASH` or `_SOCK`; `experiments/` |
| `no-redacted-value.ts` | `Redacted.value`, called or handed on | seven edge files, each with its reason in `.oxlintrc.json`; tests; `experiments/` |

And a test, `packages/fabrika/src/redacted.test.ts`, that a secret shows
`<redacted>` through `String`, a template, `JSON.stringify`, Node's inspect,
each of Effect's log formats, an Effect error and its cause, a span attribute
on its way to the exporter, and that the session schema refuses to encode it.

## Why

- **Why Effect's `Redacted` and not our own wrapper:** the repository is built
  on Effect, and its loggers, its `Cause.pretty`, its HTTP headers
  (`HttpClientRequest.bearerToken` takes one) and its OpenTelemetry bridge
  already know it. Our own type would need every one of those taught again.
- **Why a lint rule beside the types:** the type cannot see a `process.env`
  read, which is a plain string from the start, and it cannot stop a
  `Redacted.value` in the middle of the code. The two rules close those two
  doors.
- **Why the edge files are named by path and not by an `oxlint-disable`:** the
  list is short and each entry has a reason in one place. A new edge is a
  change to `.oxlintrc.json` that a reviewer sees.

## What it costs

- Every new secret needs a `Config.Redacted` read and a `Redacted.value` at
  its edge, in a listed file. A few lines each.
- A test that checks a real token's text must read it back with
  `Redacted.value`; tests are left out of the second rule for that.
- The door's tests changed where they passed a plain string as a token.

## How sure

About 85% that this closes the accidental leaks our own code could make: the
counts below are small and every fire was looked at. The doubt is the shapes
the rules do not see (next section). A secret scanner on the ledger's text and
on a pull request's diff, counted for false alarms first, would lift it.

## What it does not cover

- **An agent in a box can still read its own environment.** The model login
  goes into a job's box on purpose ([programs run in a box](./programs-run-in-a-box.md)),
  and a shell there can print it. `Redacted` lives in our process; a child
  process gets plain text, because that is what an env is. The keep-lists in
  `packages/fabrika/src/agents/claude/env.ts` limit which names go in; they do
  not hide the values from the child.
- **A whole environment handed on**, as `{...process.env}` or those
  keep-lists. The values are never read by our code there, but nothing types
  them.
- **A name the rule is not given** (`process.env[name]`), a Worker's
  `env.GITHUB_TOKEN` (wrapped at the read by hand today), and a secret whose
  name has none of the words.
- **`value` imported under its own name** from `effect/Redacted`.
- **Text a secret is already inside**, such as a URL with a token in it, or a
  tool's own output that prints it.
- **`experiments/`.** Old scripts read keys as plain strings; the rules leave
  the folder out, and `oxlint-plugins/README.md` counts what they would find.

## What would change this

A leak this did not stop, in a log or a trace from a real run. Then the shape
it took becomes a third rule, or a test.
