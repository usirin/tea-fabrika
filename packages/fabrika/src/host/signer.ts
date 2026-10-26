// What signs a login: an SSH key, as the door checks it (`door.ts`, `sshsig.ts`). A person's key is
// one the ledger's keys service lists for them (`keys.ts`; on GitHub's, a key GitHub lists for their
// login). An agent's key is its own, named in a grant its person signed.
//
//   const session = yield* door.login("alice")          // signs this ledger's challenge with Signer
//   const g = yield* grant({address, agent: "triage", key: agentKey, for: "alice", expires})
//
// `layerSignerKey` holds an Ed25519 key in WebCrypto: for a host that keeps its own agent key, and
// for tests. A person's key in ssh-agent, a key with a passphrase, and a hardware key are not in it
// yet: the app's login needs one of those.
import {Context, Effect, Layer} from "effect";
import {type Grant, grantText, NAMESPACE} from "./door.ts";
import {keyLineOf, sign} from "./sshsig.ts";

export class Signer extends Context.Service<
	Signer,
	{
		/** The public key, as a key line: `ssh-ed25519 AAAA...`. */
		readonly key: string;
		/** An SSHSIG over `text`, in the door's namespace. */
		readonly sign: (text: string) => Effect.Effect<string>;
	}
>()("@kampus/fabrika/Signer") {}

/** A Signer over an Ed25519 key pair held in WebCrypto. */
export const layerSignerKey = (pair: CryptoKeyPair): Layer.Layer<Signer> =>
	Layer.effect(
		Signer,
		Effect.gen(function* () {
			const raw = new Uint8Array(
				yield* Effect.promise(() => crypto.subtle.exportKey("raw", pair.publicKey)),
			);
			return Signer.of({
				key: keyLineOf(raw),
				sign: (text) => Effect.promise(() => sign(text, NAMESPACE, pair.privateKey, raw)),
			});
		}),
	);

/** A person's grant to one agent: the text the door reads, signed with the person's key. */
export const grant = (g: Grant) =>
	Effect.gen(function* () {
		const signer = yield* Signer;
		const text = grantText(g);
		return {text, signature: yield* signer.sign(text)};
	});
