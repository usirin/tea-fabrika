// Experiment 157's seal: how a login rests in a person's locker, a Durable Object.
//
// AES-256-GCM. The key comes from the Worker's secret by HKDF, one key per person, and the person
// and provider are bound into the tag. So a sealed login copied into another person's locker, or
// moved from `codex` to `claude`, does not open.
//
//   const s = await seal(secret, "a", "codex", login);   // {iv, ct}, base64
//   await open(secret, "a", "codex", s)                  // the login
//   await open(secret, "b", "codex", s)                  // null
//
// Web Crypto only, erasable TypeScript with no imports: the Worker and Node run the same file.

export interface Sealed {
	readonly iv: string;
	readonly ct: string;
}

const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const keyOf = async (secret: string, person: string) => {
	const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, [
		"deriveKey",
	]);
	return crypto.subtle.deriveKey(
		{name: "HKDF", hash: "SHA-256", salt: enc.encode("exp157 login"), info: enc.encode(person)},
		base,
		{name: "AES-GCM", length: 256},
		false,
		["encrypt", "decrypt"],
	);
};

export const seal = async (
	secret: string,
	person: string,
	provider: string,
	value: unknown,
): Promise<Sealed> => {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt(
		{name: "AES-GCM", iv, additionalData: enc.encode(`${person}/${provider}`)},
		await keyOf(secret, person),
		enc.encode(JSON.stringify(value)),
	);
	return {iv: b64(iv), ct: b64(new Uint8Array(ct))};
};

/** The value, or null when the seal is not this person's and this provider's. */
export const open = async (
	secret: string,
	person: string,
	provider: string,
	sealed: Sealed,
): Promise<unknown> => {
	try {
		const plain = await crypto.subtle.decrypt(
			{name: "AES-GCM", iv: unb64(sealed.iv), additionalData: enc.encode(`${person}/${provider}`)},
			await keyOf(secret, person),
			unb64(sealed.ct),
		);
		return JSON.parse(new TextDecoder().decode(plain));
	} catch {
		return null;
	}
};
