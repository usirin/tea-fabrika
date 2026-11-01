# Codex's box closes what is in home, not home itself

**Proposed.** About today's version: `homeFence` in `packages/fabrika/src/agents/acp/harness.ts`.

```ts
// A sketch of the table Codex gets on a Mac, for a run in ~/work/copy with Volta as a tool.
const filesystem = {
	"~/[!.wW]*": "deny", // what starts with neither `.` nor `w`, in either case, and what is in it
	"~/[!.wW]*/**": "deny",
	"~/.[!vV]*": "deny", // what starts with `.`, then not `v`
	"~/.[!vV]*/**": "deny",
	"~/w[!oO]*": "deny", // what starts with `w`, then not `o`
	"~/w[!oO]*/**": "deny",
	"~/w": "deny", // a prefix that is an entry of its own
	"~/w/**": "deny",
	"~/.vscode": "deny", // past two characters, what shares them is listed by name
	"~/work2": "deny",
	"~/work/[!cC]*": "deny", // and the same one folder down
	"~/work/[!cC]*/**": "deny",
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
- **Case does not count.** The box's matcher takes no regard of case on a Mac: `l[!a]*` also closes
  `Library`. So the walk goes by a start with no case, with one branch per start, and each class holds
  both cases of a character. `~/Library/pnpm` with `~/lab/copy` gives `~/[!lL]*`, then `~/l[!aAiI]*`. A
  near name in either case is closed by name.
- **A case-sensitive volume gets the same table.** We ran it on a case-sensitive APFS image in the real
  box: the opened folders work, and `~/Lab` and `~/LAB` beside `~/lab` are closed. Twins that exist
  before the run are listed by name. One made during a run is open, as below.
- **Odd names are listed.** A class and `?` work by byte. So if a way down has anything outside
  `[A-Za-z0-9._ -]` in its first two characters, or its folder's path does, that folder lists every
  entry by name.
- **Off a Mac there are no patterns.** Nothing proves they work there, and a pattern that matched
  nothing would leave a name open. `depth` is 2 on a Mac and 0 elsewhere, and 0 lists every entry.

Rules from before still stand. A name Codex would read as a pattern is written as a pattern that
matches it. Codex refuses a pattern that opens, so an opened path with such a name gets no line.

## Which home, and which login

`HOME` can say another folder than the account's own. So the table closes both: the one in `HOME`, and
the one the system gives for the account. A home with nothing opened in it is one `deny` line.

`CODEX_HOME` can move the login out of home. So the login is closed by its path and by its real target,
wherever those are, in the exec adapter and in ACP's row.

## What a tool opens

A tool opens the folder above the one holding it, so a version manager's whole folder. Only the holding
folder opens if the one above is shared, is home or above it, or holds a login. Holding a login means a
known login path (`~/.cargo/credentials.toml`) or a file named like one in that folder itself
(`credentials`, `auth.json`, `.npmrc`). The toolchain and Codex's own binary follow this one rule, so
`~/.cargo/bin/codex` opens `~/.cargo/bin` and never `~/.cargo`.

A run in a lane's tree also opens the clone's `.git`, to read. A tree's `.git` is a file that leads
there, and `git status`, `git diff` and `git log` need it. It counts only for a real worktree of that
tree, so a `.git` an agent wrote opens nothing next turn. `git add` and `git commit` are refused in the
box, which is fine: the lane stages and commits outside it. In the box, Codex's own rule also refuses
any change to the tree's `.git`, and nothing in the clone is writable.

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
- A login that is a link to a folder holding the run's folder, or a tool. That folder gets no line.
- A link in a walked folder that leads to something a run needs. The box follows a key that is a link, so
  closing the link closes where it leads. `~/c` to `~/work/copy` stops the run, `~/work2` to `~/work`
  stops Node, which looks at each parent, and `~/bin4` to `/bin` stops what is in `/bin`.

A tool that really is a link to a plain folder opens that folder. That is what it asked for.

## What is weaker than a closed home

- A command can list the names in home, and in each folder on the way down to an opened one.
- An entry made after the table that shares its first two characters with a way down is open. With
  `~/work` as the way, a `~/work3` made during a run stays open, and so does a `~/WORK3`. With
  `~/.codex/packages` opened, so is any new `~/.c*`. In a folder that lists every entry, and off a Mac,
  anything made later is open.
- A `?` can also close a name beside the one it stands for. If that name holds the opened folder, the
  run fails closed.
- Reads outside home are open. So a key inside a login folder that links outside home (`~/.ssh/id_x` to
  a file elsewhere) is closed by its path, and readable at its target by whoever names it. We do not read
  a login folder's insides to find such a link. Codex's own login is the one exception, as above.
- A login we do not know the name of is not seen. A tool's folder is checked for known names in it, not
  any deeper.
- A run in a lane's tree can read the clone's whole `.git`: every branch, and the remote's address.
- No box caps its processes. See the next section.

We accept the second because the files that hold logins exist before a run starts, and
`ALWAYS_CLOSED` covers the login paths that do not. An entry made after the table that starts
differently from every way down is closed.

## A Volta shim can start itself without end

A Volta shim under another home finds no tools. It looks along the `PATH` for the real tool, finds
itself, and waits on the child it starts. That chain grows until the account's process limit stops it.
`toolHome` keeps `VOLTA_HOME` for the plain case: a `.volta/bin` on the `PATH`, under that exact name.
The chain can still happen with:

- `VOLTA_HOME=""`, which is passed on as it is;
- a `VOLTA_HOME` other than the shim's own folder;
- a shim's folder not named `.volta`;
- `.VOLTA/bin`, which the rule's exact name does not match.

No box caps its processes, so nothing here stops such a chain but the account's own limit. We have not
built a cap.

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

A box with almost no table takes 0.024 s, so the short table costs about 0.04 s per command. With names
walked without case, the same home took 104 lines, `date` 0.044 s and `node` 0.066 s in `codex sandbox`.
No real turn has run on that table.

The turn was the same one both times: `node x.js`, `pnpm --version`, `date +%s` five times, one at a
time, model `gpt-6-astra`, effort `low`, on a Codex plan. The "before" turn ran under the old code.

The times per command are not read in the same way. "Before" is between the turn's own events. "After"
is between a call and its output in Codex's log, since those events now come too close together to
read: 0 to 33 ms apart.

On this home `node`, `pnpm` and a write in the folder exit 0. These are refused, with "not permitted":
`.ssh`, `.config/gh/hosts.yml`, `.npmrc`, `.git-credentials`, a key file under a dot folder,
`.claude.json`, `.docker/config.json`.

## How big a table can get

Past what it can take, Codex's box runs nothing: that part fails closed by itself. But its answer comes
per command, and reads like a broken tool. So `fenceTooBig` stops the table first. The turn fails with
why `contain`, no Codex starts, no Codex home is made, and the message gives the counts and names no
entry.

```ts
fenceTooBig(table);
// "Codex's box would need 240 lines to close what is beside the opened folders, and those are too
//  long or too deep for it. Nothing was started. Use a folder nearer the top of home, with fewer
//  long names beside it."
```

Where the real box stops, in `codex sandbox`, by what the keys are. A depth counts folders from the
top of the disk.

| Keys | Works at | Stops at | How it stops |
|---|---|---|---|
| Plain names, 250 bytes | 254 lines | 256 | exit 65, "pattern serialization length exceeds 65535" |
| Plain names, 100 bytes | 614 lines | 618 | exit 65, the same |
| Plain names, 50 bytes | 1,171 lines | 1,182 | exit 65, the same |
| Plain names, short | 1,889 lines | 1,921 | exit 65, "profile compilation failed" |
| Pairs of patterns, depth 6 | 1,325 lines | 1,346 | exit 1, "Argument list too long" |
| Pairs of patterns, depth 10 | 855 lines | 865 | exit 1, "Argument list too long" |
| Pairs of patterns, depth 22 | 375 lines | 380 | exit 1, "Argument list too long" |
| Pairs of patterns, depth 36 | 209 lines | 212 | exit 1, "Argument list too long" |

So there are three limits, and `fenceTooBig` weighs each.

- **Lines.** At most 600. Plain names at 600 lines take about 2.5 s per command, slow but working.
- **Bytes the keys do not share.** The box compiles its paths into one pattern of at most 65,535 bytes,
  and what keys share is stored once. A long folder the keys share does not count. Each key costs what
  is new in it and about 7 bytes more. Ours stops at 59,000, 90% of the limit.
- **The profile's size.** It must fit in a command's arguments, 1 MiB, and only patterns swell it. A
  pattern costs about 5 per byte and 130 per folder. That fit comes out high at each row above. Ours
  stops at 900,000.

The real home's 127 lines are 21% of the first limit. Tests hold each side in the real box: a table we
allow runs, and one past the real stop gets our message, not Codex's.

We never saw "too many levels of backtracking".

## How sure

About 85% that this is the right table on a Mac. Each near name, odd name, link and spelling above is
tested in the real box, and the by-hand attack boxes found nothing open but a tool that really links to
a plain folder. The doubt is what one home and one turn cannot show. More runs on other homes would
settle it.

About 75% on the size weights. They are fits from eight rows on one machine, and a wrong one costs
Codex's message instead of ours, or a refusal the box did not need. Measuring more shapes would settle
it.

The other way is to deny home whole. It is stronger and needs no table, but no Node tool under home
could run. If Codex adds a way to deny a folder's contents and still allow `lstat` on it, this note
should be dropped.

## What it cannot tell us

- It has not run on Linux. Linux lists every entry, by `depth` 0, and nothing is tested there. That
  list goes to the model too. The limit of 600 was measured on a Mac, so a Linux home with more entries
  beside an opened folder is refused without proof it had to be.
- It has not run on the Codex this repo pins for ACP's row, 0.159.3. That version's box does not
  start on the Mac tested (`unbound variable: TIOCSTI`), so the same table is unproved there.
- A writable folder reached through a link is proved in `codex sandbox`, not in `codex exec`. So are git
  in a lane's tree, and Codex's own refusal of changes to its `.git`: no model was called.
- Whether a real run hits an odd name it has not met yet. The tests cover the names we thought of.
- Whether the token drop is all the table's doing. The turn's commands were the same, but a model does
  not answer the same way twice.
