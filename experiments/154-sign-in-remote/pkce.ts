// PKCE (RFC 7636) with S256, and the random values a sign-in needs, on Web Crypto only, so the same
// file runs in Node, in a box and in a Worker. No Node import.
//
//   const {verifier, challenge} = await pkce();
//   // challenge === base64url(sha256(verifier)); the verifier never leaves the box
//   await challengeOf(verifier) === challenge   // what the sign-in server checks at the trade

const b64url = (bytes: Uint8Array) => {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** `n` random bytes as base64url: 32 bytes gives 43 characters, RFC 7636's shortest verifier. */
export const randomValue = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export const challengeOf = async (verifier: string) =>
	b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));

export const pkce = async () => {
	const verifier = randomValue(32);
	return {verifier, challenge: await challengeOf(verifier)};
};

/** A fresh installation id, OpenAI's `ext_agent_host_id`: `urn:uuid:<uuid>`. */
export const hostId = () => `urn:uuid:${crypto.randomUUID()}`;
