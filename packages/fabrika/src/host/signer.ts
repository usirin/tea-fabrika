// What signs a login: an SSH key, as the door checks it (`door.ts`, `sshsig.ts`). A person's key is
// one the ledger's keys service lists for them (`keys.ts`; on GitHub's, a key GitHub lists for their
// login). An agent's key is its own, named in a grant its person signed.
//
//   const session = yield* door.login("alice")          // signs this ledger's challenge with Signer
//   const g = yield* grant({address, agent: "triage", key: agentKey, for: "alice", expires})
//
// `layerSignerKey` holds an Ed25519 key in WebCrypto: for a host that keeps its own agent key, and
// for tests. `layerSignerFile` reads a person's own key file, as `ssh-keygen -t ed25519` wrote it,
// with no passphrase. A key in ssh-agent, a key with a passphrase, and a hardware key are not in
// it yet.
import {Context, Effect, FileSystem, Layer, Redacted, Schema} from "effect";
import {type Grant, grantText, NAMESPACE} from "./door.ts";
import {keyFileOf, keyLineOf, sign} from "./sshsig.ts";

/** The key file could not be read, or is no key this signer can use; `why` in words. */
export class KeyUnreadable extends Schema.TaggedError<KeyUnreadable>()("KeyUnreadable", {
	path: Schema.String,
	why: Schema.String,
}) {}

export class Signer extends Context.Service<
	Signer,
	{
		/** The public key, as a key line: `ssh-ed25519 AAAA...`. */
		readonly key: string;
		/** An SSHSIG over `text`, in the door's namespace. */
		readonly sign: (text: string) => Effect.Effect<string>;
	}
>()("@kampus/fabrika/Signer") {}

const signerOf = (pair: CryptoKeyPair) =>
	Effect.gen(function* () {
		const raw = new Uint8Array(
			yield* Effect.promise(() => crypto.subtle.exportKey("raw", pair.publicKey)),
		);
		return Signer.of({
			key: keyLineOf(raw),
			sign: (text) => Effect.promise(() => sign(text, NAMESPACE, pair.privateKey, raw)),
		});
	});

/** A Signer over an Ed25519 key pair held in WebCrypto. */
export const layerSignerKey = (pair: CryptoKeyPair): Layer.Layer<Signer> =>
	Layer.effect(Signer, signerOf(pair));

/** A Signer over the OpenSSH key file at `path` (`~/.ssh/id_ed25519`), read once. */
export const layerSignerFile = (
	path: string,
): Layer.Layer<Signer, KeyUnreadable, FileSystem.FileSystem> =>
	Layer.effect(
		Signer,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const text = yield* fs.readFileString(path).pipe(
				Effect.map(Redacted.make),
				Effect.mapError((e) => new KeyUnreadable({path, why: e.message})),
			);
			// The private key is in the clear only here, handed to the parser that imports it.
			const read = yield* Effect.promise(() => keyFileOf(Redacted.value(text)));
			if (!read.ok) return yield* new KeyUnreadable({path, why: read.why});
			return yield* signerOf(read.pair);
		}),
	);

/** A person's grant to one agent: the text the door reads, signed with the person's key. */
export const grant = (g: Grant) =>
	Effect.gen(function* () {
		const signer = yield* Signer;
		const text = grantText(g);
		return {text, signature: yield* signer.sign(text)};
	});
