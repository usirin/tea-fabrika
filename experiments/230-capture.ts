// Run outside Codex's macOS sandbox. Only public bytes leave the virtual authenticator.
import assert from "node:assert/strict";
import {existsSync, writeFileSync} from "node:fs";
import {chromium} from "../apps/fabrika/node_modules/playwright/index.mjs";

const hex = process.argv[2];
assert(
	process.argv.length === 3 && hex !== undefined && /^(?:[\da-f]{2})+$/i.test(hex),
	"usage: node experiments/230-capture.ts <challenge-hex>",
);
const destination = new URL("./results/230-assertion.json", import.meta.url);
assert(
	!existsSync(destination),
	"230-assertion.json already exists; preserve the recorded fixture",
);

const rpId = "fabrika.test";
const origin = `https://${rpId}`;
const browser = await chromium.launch({headless: true});
try {
	const context = await browser.newContext({serviceWorkers: "block"});
	const page = await context.newPage();
	await page.route("**/*", async (route) => {
		if (route.request().url() === `${origin}/`) {
			await route.fulfill({
				contentType: "text/html",
				body: '<!doctype html><title>Passkey SSHSIG spike</title><link rel="icon" href="data:,">',
			});
		} else {
			await route.abort("blockedbyclient");
		}
	});
	const cdp = await context.newCDPSession(page);
	await cdp.send("WebAuthn.enable");
	const {authenticatorId} = await cdp.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			ctap2Version: "ctap2_1",
			transport: "internal",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
			defaultBackupEligibility: true,
			defaultBackupState: true,
		},
	});
	await page.goto(`${origin}/`);
	const enrollment = await page.evaluate(async (rp) => {
		const base64url = (bytes: ArrayBuffer) =>
			btoa(String.fromCharCode(...new Uint8Array(bytes)))
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/, "");
		const credential = await navigator.credentials.create({
			publicKey: {
				challenge: crypto.getRandomValues(new Uint8Array(32)),
				rp: {id: rp, name: "SSHSIG spike"},
				user: {
					id: crypto.getRandomValues(new Uint8Array(16)),
					name: "spike",
					displayName: "Spike",
				},
				pubKeyCredParams: [{type: "public-key", alg: -7}],
				authenticatorSelection: {
					authenticatorAttachment: "platform",
					residentKey: "required",
					userVerification: "required",
				},
				attestation: "none",
			},
		});
		if (
			!(credential instanceof PublicKeyCredential) ||
			!(credential.response instanceof AuthenticatorAttestationResponse)
		) {
			throw new Error("expected a public-key registration response");
		}
		const response = credential.response;
		const spki = response.getPublicKey();
		if (spki === null || response.getPublicKeyAlgorithm() !== -7) {
			throw new Error("expected an ES256 public key");
		}
		const publicKey = await crypto.subtle.importKey(
			"spki",
			spki,
			{name: "ECDSA", namedCurve: "P-256"},
			true,
			["verify"],
		);
		return {
			credentialId: base64url(credential.rawId),
			publicKey: base64url(await crypto.subtle.exportKey("raw", publicKey)),
			publicKeySpki: base64url(spki),
			authenticatorData: base64url(response.getAuthenticatorData()),
			clientDataJSON: base64url(response.clientDataJSON),
			attestationObject: base64url(response.attestationObject),
		};
	}, rpId);
	// This CDP method changes the counter without ever exporting the credential's private key.
	await cdp.send("WebAuthn.setCredentialProperties", {
		authenticatorId,
		credentialId: Buffer.from(enrollment.credentialId, "base64url").toString("base64"),
		signCount: -1,
	});
	const assertion = await page.evaluate(
		async ({challengeHex, credentialId, rp}) => {
			const base64url = (bytes: ArrayBuffer) =>
				btoa(String.fromCharCode(...new Uint8Array(bytes)))
					.replace(/\+/g, "-")
					.replace(/\//g, "_")
					.replace(/=+$/, "");
			const id = Uint8Array.from(atob(credentialId.replace(/-/g, "+").replace(/_/g, "/")), (char) =>
				char.charCodeAt(0),
			);
			const challenge = Uint8Array.from(challengeHex.match(/../g) ?? [], (pair) =>
				Number.parseInt(pair, 16),
			);
			const credential = await navigator.credentials.get({
				publicKey: {
					rpId: rp,
					challenge,
					allowCredentials: [{type: "public-key", id, transports: ["internal"]}],
					userVerification: "required",
				},
			});
			if (
				!(credential instanceof PublicKeyCredential) ||
				!(credential.response instanceof AuthenticatorAssertionResponse)
			) {
				throw new Error("expected a public-key assertion response");
			}
			return {
				credentialId: base64url(credential.rawId),
				authenticatorData: base64url(credential.response.authenticatorData),
				clientDataJSON: base64url(credential.response.clientDataJSON),
				signature: base64url(credential.response.signature),
			};
		},
		{challengeHex: hex, credentialId: enrollment.credentialId, rp: rpId},
	);
	const data = Buffer.from(assertion.authenticatorData, "base64url");
	writeFileSync(
		destination,
		`${JSON.stringify(
			{
				...assertion,
				publicKey: enrollment.publicKey,
				publicKeySpki: enrollment.publicKeySpki,
				flags: data.subarray(32, 33).toString("base64url"),
				rpId: Buffer.from(rpId).toString("base64url"),
				origin: Buffer.from(origin).toString("base64url"),
				challenge: Buffer.from(hex, "hex").toString("base64url"),
				browser: Buffer.from(browser.version()).toString("base64url"),
				enrollment,
			},
			null,
			2,
		)}\n`,
		{flag: "wx"},
	);
	console.log("wrote experiments/results/230-assertion.json");
	// Keep the public bytes even if an authenticator returned unexpected flags or a counter.
	assert.equal(assertion.credentialId, enrollment.credentialId);
	assert(data.length >= 37, "authenticatorData must contain the RP hash, flags and counter");
	const flags = data[32];
	assert(flags !== undefined && (flags & 0x1d) === 0x1d, "expected UP, UV, BE and BS");
	assert.equal(data.readUInt32BE(33), 0, "expected a zero counter");
} finally {
	await browser.close();
}
