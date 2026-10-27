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

// ---------------------------------------------------------------- a key file

// OpenSSH's own private key file, `-----BEGIN OPENSSH PRIVATE KEY-----`, what `ssh-keygen -t
// ed25519` writes (PROTOCOL.key in openssh-portable):
//
//   "openssh-key-v1\0" string(cipher) string(kdf) string(kdf options) u32(keys: 1)
//   string(public key blob) string(private part)
//   private part = u32(check) u32(check) string("ssh-ed25519") string(public 32)
//                  string(seed 32 + public 32) string(comment) padding 1, 2, 3, ...
//
// Only a key with no passphrase (cipher and kdf "none") reads here. A key with one is refused,
// with that reason: the app has no prompt for it yet.

const KEY_BEGIN = "-----BEGIN OPENSSH PRIVATE KEY-----";
const KEY_END = "-----END OPENSSH PRIVATE KEY-----";
const KEY_MAGIC = "openssh-key-v1\0";
/** PKCS #8's wrapping of an Ed25519 seed (RFC 8410): this, then the 32 bytes. */
const PKCS8_ED25519 = Uint8Array.of(
	0x30,
	0x2e,
	0x02,
	0x01,
	0x00,
	0x30,
	0x05,
	0x06,
	0x03,
	0x2b,
	0x65,
	0x70,
	0x04,
	0x22,
	0x04,
	0x20,
);

/** An OpenSSH key file, read: its Ed25519 pair, or why it does not read. */
export type KeyFile =
	| {readonly ok: true; readonly pair: CryptoKeyPair}
	| {readonly ok: false; readonly why: string};

/** Read an OpenSSH private key file's text. The private key is not extractable. */
export const keyFileOf = async (text: string): Promise<KeyFile> => {
	const no = (why: string): KeyFile => ({ok: false, why});
	const t = text.trim();
	if (!t.startsWith(KEY_BEGIN) || !t.endsWith(KEY_END)) return no("not an OpenSSH private key");
	const blob = fromBase64(t.slice(KEY_BEGIN.length, -KEY_END.length).replace(/\s+/g, ""));
	if (blob === null) return no("not an OpenSSH private key");
	const r = reader(blob);
	const magic = r.take(KEY_MAGIC.length);
	if (magic === null || dec.decode(magic) !== KEY_MAGIC) return no("not an OpenSSH private key");
	const cipher = r.string();
	const kdf = r.string();
	r.string();
	if (cipher === null || kdf === null) return no("not an OpenSSH private key");
	if (dec.decode(cipher) !== "none" || dec.decode(kdf) !== "none")
		return no("the key has a passphrase, and fabrika cannot ask for one yet");
	if (r.u32() !== 1) return no("a key file with more than one key");
	r.string();
	const part = r.string();
	if (part === null) return no("not an OpenSSH private key");
	const p = reader(part);
	const c1 = p.u32();
	const c2 = p.u32();
	const type = p.string();
	const pub = p.string();
	const secret = p.string();
	if (c1 === null || c1 !== c2) return no("the key file is damaged");
	if (type === null || dec.decode(type) !== ED25519) return no("only an Ed25519 key reads yet");
	if (pub === null || pub.length !== 32 || secret === null || secret.length !== 64)
		return no("the key file is damaged");
	if (!same(secret.slice(32), pub)) return no("the key file is damaged");
	const privateKey = await crypto.subtle.importKey(
		"pkcs8",
		concat([PKCS8_ED25519, secret.slice(0, 32)]),
		{name: "Ed25519"},
		false,
		["sign"],
	);
	const publicKey = await crypto.subtle.importKey("raw", pub, {name: "Ed25519"}, true, ["verify"]);
	return {ok: true, pair: {privateKey, publicKey}};
};

/**
 * An Ed25519 pair as an OpenSSH private key file with no passphrase, as `ssh-keygen -t ed25519 -N
 * ""` writes one. Its private key must be extractable. For tests, and a host making its own key.
 */
export const keyFileText = async (pair: CryptoKeyPair, comment = ""): Promise<string> => {
	const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
	const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
	const seed = pkcs8.slice(pkcs8.length - 32);
	const check = u32(crypto.getRandomValues(new Uint32Array(1))[0] ?? 0);
	const body = concat([
		check,
		check,
		str(ED25519),
		str(pub),
		str(concat([seed, pub])),
		str(comment),
	]);
	const pad = (8 - (body.length % 8)) % 8;
	const padding = Uint8Array.from({length: pad}, (_, i) => i + 1);
	const blob = concat([
		enc.encode(KEY_MAGIC),
		str("none"),
		str("none"),
		str(""),
		u32(1),
		str(concat([str(ED25519), str(pub)])),
		str(concat([body, padding])),
	]);
	const lines = toBase64(blob).match(/.{1,70}/g) ?? [];
	return `${[KEY_BEGIN, ...lines, KEY_END].join("\n")}\n`;
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
