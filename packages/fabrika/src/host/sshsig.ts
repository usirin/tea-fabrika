// SSH signatures in the SSHSIG format: what `ssh-keygen -Y sign -n <namespace>` writes, and what
// `ssh-keygen -Y verify` checks. The door uses it to check that a person holds a key the keys
// service lists for them (`keys.ts`; on GitHub's, the keys GitHub lists for their login).
//
//   const armored = await sign(text, NAMESPACE, key)     // -----BEGIN SSH SIGNATURE----- ...
//   await verify(armored, text, NAMESPACE, listedKeys)   // the key line that signed it, or null
//
// The format, from OpenSSH's own spec (PROTOCOL.sshsig,
// https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.sshsig):
//
//   blob    = "SSHSIG" u32(1) string(public key) string(namespace) string(reserved)
//             string(hash algorithm) string(signature)
//   signed  = "SSHSIG" string(namespace) string(reserved) string(hash algorithm)
//             string(H(message))
//
// A `string` is a u32 length and its bytes (RFC 4251). The namespace is inside what is signed, so a
// signature made for git commits (`-n git`) is no signature here.
//
// Ed25519 keys only, for now. RSA and ECDSA keys, keys with a passphrase (the signing side), an
// ssh-agent and hardware keys (`sk-ssh-ed25519@openssh.com`) are not in it yet.
//
// Erasable TypeScript, no imports: workerd runs this file bundled into the ledger's Worker
// (worker-options.ts), and Node runs the same file. Both have WebCrypto's Ed25519.

type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();
const dec = new TextDecoder();
const MAGIC = "SSHSIG";
const ED25519 = "ssh-ed25519";
const BEGIN = "-----BEGIN SSH SIGNATURE-----";
const END = "-----END SSH SIGNATURE-----";

const bytes = (n: number): Bytes => new Uint8Array(new ArrayBuffer(n));

const concat = (parts: readonly Uint8Array[]): Bytes => {
	const out = bytes(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
};

const u32 = (n: number): Bytes => {
	const b = bytes(4);
	new DataView(b.buffer).setUint32(0, n);
	return b;
};

/** RFC 4251's `string`: its length, then its bytes. */
const str = (b: Uint8Array | string): Bytes => {
	const raw = typeof b === "string" ? enc.encode(b) : b;
	return concat([u32(raw.length), raw]);
};

const fromBase64 = (text: string): Bytes | null => {
	try {
		const bin = atob(text);
		const out = bytes(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
};

const toBase64 = (b: Uint8Array): string => {
	let bin = "";
	for (const x of b) bin += String.fromCharCode(x);
	return btoa(bin);
};

const same = (a: Uint8Array, b: Uint8Array): boolean =>
	a.length === b.length && a.every((x, i) => x === b[i]);

/** Reads RFC 4251's fields in order; any read past the end gives null. */
const reader = (b: Bytes) => {
	let at = 0;
	const take = (n: number): Bytes | null => {
		if (n < 0 || at + n > b.length) return null;
		const out = b.slice(at, at + n);
		at += n;
		return out;
	};
	return {
		take,
		u32: (): number | null => {
			const four = take(4);
			return four === null ? null : new DataView(four.buffer).getUint32(0);
		},
		string(): Bytes | null {
			const n = this.u32();
			return n === null ? null : take(n);
		},
		done: () => at === b.length,
	};
};

/** The key blob of an Ed25519 key line (`ssh-ed25519 AAAA... comment`), or null: not one. */
export const keyBlobOf = (line: string): Bytes | null => {
	const [type, b64] = line.trim().split(/\s+/);
	if (type !== ED25519 || b64 === undefined) return null;
	const blob = fromBase64(b64);
	if (blob === null) return null;
	const r = reader(blob);
	const t = r.string();
	const pk = r.string();
	if (t === null || dec.decode(t) !== ED25519 || pk === null || pk.length !== 32 || !r.done())
		return null;
	return blob;
};

/** An Ed25519 public key (32 bytes) as a key line, `ssh-ed25519 AAAA...`. */
export const keyLineOf = (raw: Uint8Array): string =>
	`${ED25519} ${toBase64(concat([str(ED25519), str(raw)]))}`;

/** A key line with no comment, so two lines of one key compare equal. */
export const keyOnly = (line: string): string | null => {
	const blob = keyBlobOf(line);
	return blob === null ? null : `${ED25519} ${toBase64(blob)}`;
};

/** WebCrypto's name for each hash a signature may name. A Map: the name is the signature's word, so `constructor` is no hash. */
const HASHES: ReadonlyMap<string, string> = new Map([
	["sha512", "SHA-512"],
	["sha256", "SHA-256"],
]);

const signedData = async (message: string, namespace: string, hash: string): Promise<Bytes> => {
	const algo = HASHES.get(hash);
	if (algo === undefined) throw new Error(`no such hash: ${hash}`);
	const digest = new Uint8Array(await crypto.subtle.digest(algo, enc.encode(message)));
	return concat([enc.encode(MAGIC), str(namespace), str(""), str(hash), str(digest)]);
};

type Parsed = {key: Bytes; namespace: string; hash: string; signature: Bytes};

/** An armored SSHSIG, read; null: not one, or not an Ed25519 one. */
export const parse = (armored: string): Parsed | null => {
	const t = armored.trim();
	if (!t.startsWith(BEGIN) || !t.endsWith(END)) return null;
	const blob = fromBase64(t.slice(BEGIN.length, -END.length).replace(/\s+/g, ""));
	if (blob === null) return null;
	const r = reader(blob);
	const magic = r.take(MAGIC.length);
	if (magic === null || dec.decode(magic) !== MAGIC || r.u32() !== 1) return null;
	const key = r.string();
	const namespace = r.string();
	const reserved = r.string();
	const hash = r.string();
	const sig = r.string();
	if (key === null || namespace === null || reserved === null || hash === null || sig === null)
		return null;
	if (!r.done()) return null;
	const s = reader(sig);
	const type = s.string();
	const raw = s.string();
	if (type === null || dec.decode(type) !== ED25519 || raw === null || raw.length !== 64)
		return null;
	if (!s.done()) return null;
	if (keyBlobOf(`${ED25519} ${toBase64(key)}`) === null) return null;
	return {key, namespace: dec.decode(namespace), hash: dec.decode(hash), signature: raw};
};

/**
 * Which of `keys` signed `message` under `namespace`: its line, or null. Null for a signature
 * under another namespace, by a key not in `keys`, over another message, or one that does not read.
 */
export const verify = async (
	armored: string,
	message: string,
	namespace: string,
	keys: readonly string[],
): Promise<string | null> => {
	const p = parse(armored);
	if (p === null || p.namespace !== namespace || !HASHES.has(p.hash)) return null;
	const line = keys.find((k) => {
		const blob = keyBlobOf(k);
		return blob !== null && same(blob, p.key);
	});
	if (line === undefined) return null;
	// The 32 raw bytes sit after the type's string: 4 + 11 + 4.
	const raw = p.key.slice(p.key.length - 32);
	const pub = await crypto.subtle.importKey("raw", raw, {name: "Ed25519"}, false, ["verify"]);
	const data = await signedData(message, namespace, p.hash);
	const ok = await crypto.subtle.verify({name: "Ed25519"}, pub, p.signature, data);
	return ok ? line : null;
};

/**
 * Sign `message` under `namespace` with an Ed25519 key, as `ssh-keygen -Y sign` does (sha512).
 * `publicRaw`: the key's 32 public bytes. For a host that holds its key in WebCrypto, and for tests.
 */
export const sign = async (
	message: string,
	namespace: string,
	key: CryptoKey,
	publicRaw: Uint8Array,
): Promise<string> => {
	const data = await signedData(message, namespace, "sha512");
	const raw = new Uint8Array(await crypto.subtle.sign({name: "Ed25519"}, key, data));
	const blob = concat([
		enc.encode(MAGIC),
		u32(1),
		str(concat([str(ED25519), str(publicRaw)])),
		str(namespace),
		str(""),
		str("sha512"),
		str(concat([str(ED25519), str(raw)])),
	]);
	const lines = toBase64(blob).match(/.{1,70}/g) ?? [];
	return [BEGIN, ...lines, END].join("\n");
};
