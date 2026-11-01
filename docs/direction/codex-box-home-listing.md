# Codex's box closes what is in home, not home itself

**Proposed.** About today's version: `homeFence` in `packages/fabrika/src/agents/acp/harness.ts`.

```ts
// A sketch of the table Codex gets on a Mac, for a run in ~/work/copy with Volta as a tool.
const filesystem = {
	"~/[!.w]*": "deny", // what starts with neither `.` nor `w`, and what is in it
	"~/[!.w]*/**": "deny",
	"~/.[!v]*": "deny", // what starts with `.`, then not `v`
	"~/.[!v]*/**": "deny",
	"~/w[!o]*": "deny", // what starts with `w`, then not `o`
	"~/w[!o]*/**": "deny",
	"~/w": "deny", // a prefix that is an entry of its own
	"~/w/**": "deny",
	"~/.vscode": "deny", // past two characters, what shares them is listed by name
	"~/work2": "deny",
	"~/work/[!c]*": "deny", // and the same one folder down
	"~/work/[!c]*/**": "deny",
	"~/.volta": "read", // a tool, by its real path
	"~/work/copy": "write", // the folder, by its real path
	"~/.ssh": "deny", // a login path, closed whether it is there or not
	// "~": "deny" is what this replaces. It stays when nothing opened is under home.
};
```

## What changed and why

We used to deny home whole. Node's `realpathSync` looks at every parent of a script, and Seatbelt's
deny on a folder refuses even `lstat` on it. So denying home stops every Node script under home.

Then we listed each entry beside the opened folders. That worked, and it was too big. On a real home
it was 711 lines. Each command paid about 3 seconds, and every line went to the model.

So the table is now short, and made from real paths.

- **Patterns first.** At each folder on the way down, a pattern closes what does not share a start
  with a kept name, up to two characters. Past that, entries that share the start are closed by name.
- **Case does not count.** The box's class matches with no regard to case, so names are compared the
  same way. A near name in another case is closed by name.
- **Odd names are listed.** A class and `?` work by byte. So if a way down has anything outside
  `[A-Za-z0-9._ -]` in its first two characters, or its folder's path does, that folder lists every
  entry by name.
- **Off a Mac there are no patterns.** Nothing proves they work there, and a pattern that matched
  nothing would leave a name open. `depth` is 2 on a Mac and 0 elsewhere, and 0 lists every entry.

Rules from before still stand. A name Codex would read as a pattern is written as a pattern that
matches it. Codex refuses a pattern that opens, so an opened path with such a name gets no line.

## What links do now

Codex follows links, and `opens` compares written paths. So `~/t` linking to `~/.ssh`, as a tool,
opened `~/.ssh/id_x` past the narrower deny. Now the table holds real paths.

- Home, the folder and every read line are resolved first.
- A line whose real path would open home or a login gets no line. Neither does one inside a login's
  real target, or one that is not there.
- A login is closed at its real target as well as its written path. A `.ssh` that links into the
  opened folder is closed.
- A link in a folder that is walked is closed like any entry, and never walked through.

Different spellings now work: a home that is a link, a Mac's `/tmp` and its real path, `//`, `./`,
`..`, a trailing slash. Codex used to refuse a writable folder reached through a link. Its real path in the
table fixes that in `codex sandbox`.

These still fail closed:

- A folder that is a link to a login, or into `.codex`. It gets no line, so commands in it are refused.
- A folder named through a link in home. Work in it runs, but a command that names it by the link is
  refused, for the link is closed.
- A writable folder with a `"` in its path. Codex's own box does not start there.

A tool that really is a link to a plain folder opens that folder. That is what it asked for.

## What is weaker than a closed home

- A command can list the names in home, and in each folder on the way down to an opened one.
- An entry made after the table that shares its first two characters with a way down is open. With
  `~/work` as the way, a `~/work3` made during a run stays open, and so does a `~/WORK3`. In a folder
  that lists every entry, and off a Mac, anything made later is open.
- A `?` can also close a name beside the one it stands for. If that name holds the opened folder, the
  run fails closed.

We accept the first two because the names are not secrets, and the files that hold logins exist
before a run starts. `ALWAYS_CLOSED` covers the login paths that do not. An entry made after the table
that starts differently from every way down is closed.

## Which names reach the model

All of them that are in the table. Codex puts the table in a developer message, with every request.
On the real home measured, that message named 122 of the 127 keys. In it are:

- the names on the way down to each opened folder: 18 on this home;
- real entries that share two characters with one: 25 on this home;
- the two-character starts of the ways down, in patterns;
- the fixed login paths, whether they are there or not.

It is no longer every name in home. Before, that message named 555 of the 711 keys. A way-down folder
that lists every entry still sends all its names, and so does every folder walked off a Mac.

## What it costs

Measured on one real home, on a Mac, on Codex 0.165.0, at `nice -n 15`. The "every entry" column is
the same home, with `depth` 0.

| | Every entry | Two characters |
|---|---|---|
| Lines in the table | 711 | 127 |
| Patterns | 0 | 74 |
| Real entries named | 697 | 25 |
| Bytes in the table | 44,612 | 6,495 |
| `date` in `codex sandbox` | 2.98 s | 0.063 s |
| `node x.js` in `codex sandbox` | 3.0 s | 0.09 s |
| One real `codex exec` turn, before and after | 70.9 s | 19.5 s |
| Time per command in that turn | 2.2 s | 0.09 to 0.23 s |
| CPU that Codex used in that turn | 67 s | 0.93 s |
| Input tokens in that turn | 349,002 | 131,370 |
| Bytes of the developer message that holds the table | 37,800 | 10,946 |

A box with almost no table takes 0.024 s, so the short table costs about 0.04 s per command.

The turn was the same one both times: `node x.js`, `pnpm --version`, `date +%s` five times, one at a
time, model `gpt-6-astra`, effort `low`, on a Codex plan. The "before" turn ran under the old code.

The times per command are not read in the same way. "Before" is between the turn's own events. "After"
is between a call and its output in Codex's log, since those events now come too close together to
read: 0 to 33 ms apart.

On this home `node`, `pnpm` and a write in the folder exit 0. These are refused, with "not permitted":
`.ssh`, `.config/gh/hosts.yml`, `.npmrc`, `.git-credentials`, a key file under a dot folder,
`.claude.json`, `.docker/config.json`.

## How big a table can get

Over the limit, Codex's box runs nothing: that part fails closed by itself. But its answer comes per
command, and reads like a broken tool. So `fenceTooBig` stops a table over 600 lines first. The turn
fails with why `contain`, no Codex starts, no Codex home is made, and the message gives the counts and
names no entry.

```ts
fenceTooBig(table);
// "Codex's box would need 701 lines to close what is beside the opened folders,
//  and it takes at most 600. Nothing was started. Use a folder with fewer names beside it."
```

Where the real box stops, in `codex sandbox`, by what the keys are:

| Keys | Works at | Stops at | How it stops |
|---|---|---|---|
| Plain names | 1,889 lines (32 s per command) | 1,921 | exit 65, "profile compilation failed" |
| Pairs of patterns, short path | 1,665 lines | 1,697 | exit 1, "Argument list too long" |
| Half names, half patterns | 2,161 lines | 2,209 | exit 1, "Argument list too long" |
| Pairs, a path 80 characters longer | 1,025 lines | 1,041 | exit 1, "Argument list too long" |
| Pairs, 8 folders down | 753 lines | 769 | exit 1, "Argument list too long" |
| Pairs, 8 folders down, a long path | 441 lines | 449 | exit 1, "Argument list too long" |

We never saw "too many levels of backtracking". Exit 65 here says only "profile compilation failed".

The real home's 127 lines are 21% of the limit. Plain names at 600 lines take about 2.5 s per command,
slow but working. Patterns do not grow with the names in home, only with the opened folders and their
depth, so a real table should not get near the last two rows. If one does, it is under our limit and
the box still runs nothing, with Codex's own message. A test holds that: 600 lines of patterns 20
folders down run nothing.

Why 600 and not a formula: the cost grows with depth and length, about 100 bytes of the compiled
profile per folder and 4 per character for each pattern, against the system's 1 MiB. That fit comes
from six rows on one machine. A count is plain to read and to test. It costs one wrong answer: a very
deep table gets Codex's message instead of ours.

## How sure

About 85% that this is the right table on a Mac. Each near name, odd name, link and spelling above is
tested in the real box, and the 470 by-hand attack boxes found nothing open but a tool that really
links to a plain folder. The doubt is what one home and one turn cannot show. More runs on other
homes would settle it.

The other way is to deny home whole. It is stronger and needs no table, but no Node tool under home
could run. If Codex adds a way to deny a folder's contents and still allow `lstat` on it, this note
should be dropped.

## What it cannot tell us

- It has not run on Linux. Linux lists every entry, by `depth` 0, and nothing is tested there. That
  list goes to the model too. The limit of 600 was measured on a Mac, so a Linux home with more entries
  beside an opened folder is refused without proof it had to be.
- It has not run on the Codex this repo pins for ACP's row, 0.159.3. That version's box does not
  start on the Mac tested (`unbound variable: TIOCSTI`), so the same table is unproved there.
- A writable folder reached through a link is proved in `codex sandbox`, not in `codex exec`.
- Whether a real run hits an odd name it has not met yet. The tests cover the names we thought of.
- Whether the token drop is all the table's doing. The turn's commands were the same, but a model does
  not answer the same way twice.
