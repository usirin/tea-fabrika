# Codex's box closes what is in home, not home itself

**Proposed.** About today's version: `homeFence` in `packages/fabrika/src/agents/acp/harness.ts`.

```ts
// A sketch of the table Codex gets, for a run in ~/work/copy.
const filesystem = {
	"~/work/copy": "write", // the folder
	"~/.volta": "read", // a tool
	"~/Documents": "deny", // each other entry in home, listed one by one
	"~/work/old-copy": "deny", // each other entry on the way down to the folder
	"~/.ssh": "deny", // a login path, closed whether it is there or not
	"~/a[*]b": "deny", // a name Codex would read as a pattern, written as a pattern
	"~/a[*]b/**": "deny", // and what is in it
	"~/Icon?": "deny", // a control character, written as `?`
	"~/Icon?/**": "deny",
	// "~": "deny" is what this replaces. It stays when nothing opened is under home.
};
```

## What changed and why

We used to deny home whole. Node's `realpathSync` looks at every parent of a script, and Seatbelt's
deny on a folder refuses even `lstat` on it. So denying home stops every Node script under home.
A real run under the app's home would hit this.

Now code lists home and walks down to each opened folder. It denies each entry beside them.

Three rules make the table safe.

- A tool or a folder that would open home or a login gets no line. Its `read` used to overwrite
  home's `deny`.
- A name with `*`, `?`, `[` or `]` is a pattern to Codex, and a control character in a key matches
  nothing. So those names are written as patterns that match them. Written plainly, the entry
  stayed readable.
- Codex refuses a pattern that opens. So an opened path with such a name gets no line. The walk
  leaves it alone, and `:workspace` makes the working folder writable.

## What is weaker

- A command can list the names in home, and in each folder on the way down to an opened one.
- An entry made in those folders after the table is made is open, unless it is on the login list.
- A `?` can also close a name beside the one it stands for. If that name holds the opened folder,
  the run fails closed.

We accept the first two because the names are not secrets, and the files that hold logins exist
before a run starts. `ALWAYS_CLOSED` covers the login paths that do not.

## What it costs

- The table is about 650 to 700 lines on a real home.
- `codex sandbox` takes about 1.6 seconds to start at 647 entries, and 5.8 seconds at 1,000.
- It fails closed at around 5,000 entries.
- We have not measured the cost per command inside `codex exec`.

## How sure

About 70%. The closing rules are tested in the real box, for each odd name, on Codex 0.165.0. The
doubt is the cost. If each command inside `codex exec` pays the start time above, a long run would
feel it. Timing one real `codex exec` turn with a table this size would settle that. A home with
thousands of entries would fail to start, and a run on one would settle whether that needs a limit.

The other way is to deny home whole. It is stronger and needs no table, but no Node tool under home
could run. If Codex adds a way to deny a folder's contents and still allow `lstat` on it, this note
should be dropped.

## What it cannot tell us

- It has not run on Linux. Only Seatbelt on a Mac was tested.
- It has not run on the Codex this repo pins for ACP's row, 0.159.3. That version's box does not
  start on the Mac tested (`unbound variable: TIOCSTI`), so the same table is unproved there.
- A writable folder with a `"` in its path is not covered. Codex's own box does not start there.
- Whether a real run hits any odd name it has not met yet. The tests cover the names we thought of.
