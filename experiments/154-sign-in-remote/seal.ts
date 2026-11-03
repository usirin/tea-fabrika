// Way (c)'s envelope: the person's app seals a pass to one box's public key, so the shared ledger
// carries only ciphertext. The shape of HPKE's base mode (RFC 9180): a fresh ECDH P-256 key per
// message, HKDF-SHA256 over the shared secret, AES-256-GCM. Hand-made on Web Crypto, which a box,
// a Worker and the app all have; a real build would use an HPKE library instead.
//
//   const box = await makeKeys();                         // in the box; the private key never leaves
//   const sealed = await seal(box.publicKey, pass, "b1/3"); // in the person's app
//   await box.open(sealed, "b1/3");                       // in the box: the pass
//
// `about` is bound into the key and the tag: a sealed pass for one box and turn opens for no other.

const b64 = (b: ArrayBuffer | Uint8Array) =>
	btoa(String.fromCharCode(...new Uint8Array(b)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
const unb64 = (s: string) => {
	const t = s.replace(/-/g, "+").replace(/_/g, "/");
	return Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

const curve = {name: "ECDH", namedCurve: "P-256"} as const;
const text = new TextEncoder();

const keyFrom = async (secret: ArrayBuffer, about: string) => {
	const ikm = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
	return crypto.subtle.deriveKey(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: new Uint8Array(0),
			info: text.encode(`exp154 pass ${about}`),
		},
		ikm,
		{name: "AES-GCM", length: 256},
		false,
		["encrypt", "decrypt"],
	);
};

/** A box's key pair. The private key is not extractable: no code in the box can print it. */
export const makeKeys = async () => {
	const pair = await crypto.subtle.generateKey(curve, false, ["deriveBits"]);
	const publicKey = JSON.stringify(await crypto.subtle.exportKey("jwk", pair.publicKey));
	return {
		publicKey,
		open: async (sealed: string, about: string): Promise<string> => {
			const s = JSON.parse(sealed) as {epk: JsonWebKey; iv: string; ct: string};
			const epk = await crypto.subtle.importKey("jwk", s.epk, curve, false, []);
			const secret = await crypto.subtle.deriveBits(
				{name: "ECDH", public: epk},
				pair.privateKey,
				256,
			);
			const key = await keyFrom(secret, about);
			const plain = await crypto.subtle.decrypt(
				{name: "AES-GCM", iv: unb64(s.iv), additionalData: text.encode(about)},
				key,
				unb64(s.ct),
			);
			return new TextDecoder().decode(plain);
		},
	};
};

/** Seal `plain` to the box whose public key (a JWK, as JSON) this is. */
export const seal = async (publicKey: string, plain: string, about: string): Promise<string> => {
	const boxKey = await crypto.subtle.importKey(
		"jwk",
		JSON.parse(publicKey) as JsonWebKey,
		curve,
		false,
		[],
	);
	const mine = await crypto.subtle.generateKey(curve, true, ["deriveBits"]);
	const secret = await crypto.subtle.deriveBits(
		{name: "ECDH", public: boxKey},
		mine.privateKey,
		256,
	);
	const key = await keyFrom(secret, about);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt(
		{name: "AES-GCM", iv, additionalData: text.encode(about)},
		key,
		text.encode(plain),
	);
	return JSON.stringify({
		epk: await crypto.subtle.exportKey("jwk", mine.publicKey),
		iv: b64(iv),
		ct: b64(ct),
	});
};
