// An agent's own session on the home's ledger server, for as long as the agent stays (tracker
// 185). Today's version. The home's person said yes once, at `fabrika connect`, when they named
// their key file; the host signs each agent's grant with it from then on, and the person never
// meets a prompt for it.
//
//   const services = yield* Layer.build(agentLedger(home, "claude"));
//   Context.get(services, Author)    {kind: "agent", id: "claude", for: "github:7"}
//   // every row it writes, the door stamps agent:claude for:github:7, whatever the row says
//   host/log   level=INFO message=agent_session agent=claude expires=1767225600000
//
// The steps, each kept from `fabrika post` (host/post.ts, which uses this now):
//
//   the agent's key     <home>/agent_ed25519, Ed25519, mode 0600, made on first use, then kept:
//                       one key for every agent of the home's person
//   the grant           "agent claude may log in with this key, for alice, for an hour", signed
//                       with the person's key file, the one ledger.json names (signer.ts)
//   the login           the door's challenge, signed with the agent's key, and the grant
//                       (`doorOf(c).agentLogin`). The door lets an agent in only while its person
//                       has a session: on its 403, the person logs in, and the agent tries again
//   renewed             `renewing`, as the person's own session is (http.ts): a fresh grant and
//                       login 5 minutes before the end, and on a 401
//
// Each name gets its own grant and its own session, on the one key, so `claude` and `lead` write
// under their own names. A home with no server has no agent session: its agents write on the
// home's own file (host/agents.ts).
//
// Why this is safe enough: only the person's own processes reach the agents' socket (mode 0600),
// and those can read the person's key file and ledger.json already. A grant gives them nothing
// new. It only narrows them: their writes say `agent`, and the door refuses a person's answer
// from an agent's session (door.ts, `PERSON_KINDS`).

import { grant, isAgentName, keyFileText, type Ledger, layerSignerFile, Signer } from "@kampus/fabrika-old";
import { DoorRefused, doorOf, layerHttp, renewing } from "@kampus/fabrika-old/http";
import { Author } from "@tea-fabrika/tracker";
import { Clock, type Context, Effect, FileSystem, Layer, Option, Path, RcMap, type Scope } from "effect";
import { ConnectFailed, connectionOf, loginWith } from "./connection.ts";

/** The agent's key file, in the home: one key for every agent of the home's person. */
export const AGENT_KEY = "agent_ed25519";

/** How long one grant lasts: an hour, renewed before its end with the session it let in. */
const GRANT_MS = 60 * 60 * 1000;

/** The home's agent key file: made on first use (Ed25519, the person's alone), then kept. */
const agentKeyOf = (home: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = (yield* Path.Path).join(home, AGENT_KEY);

    if (yield* fs.exists(file)) {
      return file;
    }

    const text = yield* Effect.tryPromise({
      try: async () => {
        const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
        return keyFileText(pair, "fabrika agent");
      },
      catch: (cause) => new ConnectFailed({ why: `the agent's key could not be made: ${cause}` }),
    });
    yield* fs.writeFileString(file, text, { mode: 0o600 });
    return file;
  }).pipe(
    Effect.catchTag("PlatformError", (e) =>
      Effect.fail(new ConnectFailed({ why: `the agent's key could not be kept: ${e.message}` })),
    ),
  );

/**
 * The home's shared ledger as agent `name`, for the home's person: a `Ledger` on the agent's own
 * session, kept renewed while the layer's scope is open, and the `Author` the door says it is.
 * Fails with why: a name that is no agent's, a home with no server, a key that does not read, or
 * a door that said no.
 */
export const agentLedger = (
  home: string,
  name: string,
): Layer.Layer<Ledger | Author, ConnectFailed, FileSystem.FileSystem | Path.Path> =>
  Layer.unwrap(
    Effect.gen(function* () {
      if (!isAgentName(name)) {
        return yield* new ConnectFailed({
          why: `${name} is not an agent's name: lower-case letters, digits, dots, dashes, underscores`,
        });
      }

      const found = yield* connectionOf(home);

      if (Option.isNone(found)) {
        return yield* new ConnectFailed({
          why: "this home has no ledger server: fabrika connect first",
        });
      }

      const c = found.value;
      const fs = yield* FileSystem.FileSystem;
      // The agent's key, read once: what the grant names, and what signs each challenge.
      const agent = yield* Layer.build(layerSignerFile(yield* agentKeyOf(home)));
      const key = (yield* Signer.pipe(Effect.provideContext(agent))).key;
      const door = doorOf(c);
      const once = (g: { readonly text: string; readonly signature: string }) =>
        door.agentLogin(g).pipe(Effect.provideContext(agent));
      /** A fresh grant, signed with the person's key, and the agent's login on it. */
      const login = Effect.gen(function* () {
        const g = yield* grant({
          address: `${c.url}/${c.ledger}`,
          agent: name,
          key,
          for: c.login,
          expires: (yield* Clock.currentTimeMillis) + GRANT_MS,
        }).pipe(Effect.provide(layerSignerFile(c.key)));
        // No live person session: the person logs in first, then the agent once more.
        const session = yield* once(g).pipe(
          Effect.catchIf(
            (e) => e.status === 403,
            () => loginWith(c).pipe(Effect.andThen(once(g))),
          ),
        );
        yield* Effect.logInfo("agent_session").pipe(Effect.annotateLogs({ agent: name, expires: session.expires }));
        return session;
      }).pipe(Effect.provideService(FileSystem.FileSystem, fs));
      const first = yield* login.pipe(
        Effect.catchTag("KeyUnreadable", (e) => Effect.fail(new ConnectFailed({ why: `the key ${e.path}: ${e.why}` }))),
        Effect.catchTag("DoorRefused", (e) =>
          Effect.fail(new ConnectFailed({ why: `the ledger's door refused agent ${name}: ${e.why}` })),
        ),
      );
      // Later logins: a key file that cannot be read for a moment is tried again, as the network.
      const again = login.pipe(
        Effect.catchTag("KeyUnreadable", (e) =>
          Effect.fail(new DoorRefused({ status: 0, why: `the key ${e.path}: ${e.why}` })),
        ),
      );
      const session = yield* renewing(first, again);
      return Layer.merge(layerHttp({ url: c.url, ledger: c.ledger, token: session }), Layer.succeed(Author, first.who));
    }).pipe(
      Effect.catchTag("KeyUnreadable", (e) => Effect.fail(new ConnectFailed({ why: `the key ${e.path}: ${e.why}` }))),
    ),
  );

/** Agent `name`'s session on the home's ledger server, held in the caller's scope. */
export type AgentSessions = (
  name: string,
) => Effect.Effect<Context.Context<Ledger | Author>, ConnectFailed, Scope.Scope>;

/**
 * The host's agents' sessions, until the scope closes: one for each name, shared by every agent of
 * that name attached now, and no longer renewed once the last one goes. A login that failed is tried
 * again by the next agent of that name to attach after.
 */
export const agentSessions = (home: string) =>
  RcMap.make({ lookup: (name: string) => Layer.build(agentLedger(home, name)) }).pipe(
    Effect.map(
      (sessions): AgentSessions =>
        (name) =>
          RcMap.get(sessions, name),
    ),
  );
