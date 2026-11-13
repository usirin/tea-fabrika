// TicketsTest.layer: the Tickets service in memory, on one set of open tickets that a close changes
// as the tracker would. `posts` keeps every call, in order. It asks the tracker nothing.
import { Effect, Layer, Schema } from "effect";
import { Tickets, TicketsError } from "./Tickets.ts";

/** One call the layer took, as the caller made it. */
export const Post = Schema.TaggedUnion({
  list: {},
  comment: { ticket: Schema.Number, body: Schema.String },
  close: { ticket: Schema.Number },
});
export type Post = typeof Post.Type;

/** The calls that fail with a reason, by name. */
export type Failing = Partial<Record<"open" | "comment" | "close", string>>;

export type World = { readonly open: Set<number>; readonly posts: Array<Post> };

/** A fresh tracker with these tickets open. */
export const world = (open: ReadonlyArray<number> = []): World => ({ open: new Set(open), posts: [] });

export const layer = (w: World, failing: Failing = {}): Layer.Layer<Tickets> => {
  const took = (post: Post, name: keyof Failing) =>
    Effect.suspend(() => {
      w.posts.push(post);
      const reason = failing[name];
      return reason === undefined ? Effect.void : Effect.fail(new TicketsError({ reason }));
    });

  return Layer.succeed(
    Tickets,
    Tickets.of({
      open: Effect.map(took(Post.cases.list.make({}), "open"), () => [...w.open]),
      comment: (ticket, body) => took(Post.cases.comment.make({ ticket, body }), "comment"),
      close: (ticket) =>
        Effect.map(took(Post.cases.close.make({ ticket }), "close"), () => {
          w.open.delete(ticket);
        }),
    }),
  );
};
