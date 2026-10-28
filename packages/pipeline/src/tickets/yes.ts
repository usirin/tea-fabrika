import {Effect, Schema} from "effect";
import {Body, type Entry, type FactOf, type Hash, type Ticket, Title} from "./ticket.ts";

// What a yes covers, and what takes it back (docs/direction/tickets-start-in-our-tracker.md).
//
//   a person clicks approve, having read {title: "Login fails", body: "On main."}
//   tracker/ticket/3/inbox  {type: "answered", ask: "a-1", pick: "approve", note: "", text: "sha256:…"}
//   covers(answer, ticket)              // true while the title and body read the same
//
//   a person clicks "Request changes" on a comment after it
//   tracker/ticket/3/inbox  {type: "commented", body: "Skip part 2.", asks: "changes"}  by a person
//   changesAsked(timeline, answer.pos)  // true: build waits for a new plan or a new yes
//
// An agent's "request changes" is a comment like any other: it stops nothing. The hash is of a
// JSON pair, so "ab" + "c" and "a" + "bc" do not share one (experiment 138). It is Web Crypto's
// SHA-256, the same in Node, a worker and the window.

/** A ticket's text, as a person reads it: its title and its body. */
export const Text = Schema.Struct({title: Title, body: Body});
export type Text = typeof Text.Type;

/** SHA-256 of some text, as the facts spell a hash. */
export const sha256 = (text: string): Effect.Effect<Hash> =>
	Effect.promise(async () => {
		const digest = new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
		);
		return `sha256:${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")}`;
	});

/** The hash a yes names: of the title and body, as one JSON pair. */
export const hashOf = (text: Text): Effect.Effect<Hash> =>
	sha256(JSON.stringify([text.title, text.body]));

/** A ticket's text as it reads now: the title and body it was filed with. */
export const textOf = (ticket: Ticket): Text => {
	const filed = ticket.timeline[0]?.fact;
	return {title: ticket.title, body: filed?.type === "filed" ? filed.body : ""};
};

/**
 * Does this answer cover the ticket as it reads now: the same title and body, to the character.
 * An answer from before the hash covers nothing, so it is asked again.
 */
export const covers = (answer: FactOf<"answered">, ticket: Ticket): Effect.Effect<boolean> =>
	answer.text === undefined
		? Effect.succeed(false)
		: Effect.map(hashOf(textOf(ticket)), (now) => now === answer.text);

/**
 * Did a person ask for changes after the row at `since` (a yes's place on the ledger)? Only a
 * person's "Request changes" counts. An agent's, and a plain comment, never do.
 */
export const changesAsked = (timeline: readonly Entry[], since: number): boolean =>
	timeline.some(
		(e) =>
			e.pos > since &&
			e.by.kind === "user" &&
			e.fact.type === "commented" &&
			e.fact.asks === "changes",
	);
