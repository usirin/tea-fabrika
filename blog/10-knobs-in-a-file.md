# Knobs in a file, systems with SDKs

> Draft, still being written.

At 00:54 on October 5, with a probe dead on a 402 and nothing to do but wait,
I typed this:

> if we can switch to this type of coding driven workflow instead of harness driven one, we can actually drive way more things via config itself.

Forty-six minutes later the pipeline read its numbers from a file, each run
kept its own copy of them, and a check that had been skipped said so in
capitals on the record a person signs. Four commits, all before 1:41 a.m. This
last post is about those four commits, and about why they're where the series
lands. They're small, and they're the first part of tea-fabrika that looks
less like an experiment and more like something you'd build on.

## Rules in a prompt aren't knobs

Think about where a number like "0.8" lives in fabrika, my v3. It lives in a
sentence. A skill says something like "act only when the judge is sure", and
an agent reads that and decides what sure means today. If I want phoenix to be
stricter than demlik, I don't change a number. I write another sentence and
hope both agents read it the same way.

Once the loop is code, that number is a constant in a file. And a constant in
a file can move to a different file, one a person edits without touching the
code. That's all my message meant. The agent's reply listed what could move:
the floors, whether "unsure" parks or goes back to the builder, the try limit,
which model each step uses. Then it added a caveat, and it's the line from
those two days I repeat most:

> One caveat: the order of the steps should stay in code. Once config starts making if/else decisions, you've built a worse programming language.

It recommended one typed config file, checked when it loads, at 75%
confidence. Its doubt was honest: it didn't know yet which knobs actually
differ between repos, and nothing short of a real run on phoenix would show
that. I said yes. (The habit of asking for a number and the doubt behind it is
what [post 9](./09-working-with-the-agent.md) is about.)

## jsonc is not fun

The side agent building it started on JSON. Seven minutes after my first
message I sent another one:

> and i really wanna use toml config lol, jsonc is not fun

That's a taste call, and I'll own it. But there's a reason under the taste.
These knobs are flat groups of numbers with a sentence of explanation each.
TOML has real comments and sections, and no braces to balance. The parser,
[`smol-toml`](https://github.com/squirrelchat/smol-toml), is one small
dependency.

Here's a full `fabrika.toml`, every key the code accepts, each at its default:

```toml
# fabrika.toml

[jev]
model = "jev-latest"        # the Jev model every question goes to
retries = 3                 # how often a busy Jev is asked again before a reader gives up

[triage]
sort_floor = 0.8            # below this, triage doesn't take Jev's word on a sort

[lane]
attempts = 3                # builds per issue before a person is asked

[failure]
floor = 0.8                 # below this, the failure reading counts as unsure
on_unsure = "rebuild"       # "rebuild" = back to the builder, "park" = ask a person
output_chars = 20000        # how much of the END of a failed run Jev reads
diff_chars = 20000          # how much of the START of the diff Jev reads

[review]
route_floor = 0.8           # router: does an extra change serve the ticket?
match_floor = 0.9           # matcher: does a finding repeat one a person decided?
missing_floor = 0.5         # missing-file check: flag an untouched file at or above this
missing_max_files = 2000    # over this many candidate files, skip the check

[comments]
floor = 0.8                 # reader: does an owner's comment change or add a rule?
no_change_floor = 0.9       # "changes nothing" lets a comment pass, so it needs more
```

Every number in there came out of an experiment in this series. The 0.8 floors
are from the calibration in [post 2](./02-meeting-jev.md). `missing_floor =
0.5` is from experiment 36, where no file reached 0.5 on a change that was
complete (the highest was 0.48). `on_unsure = "rebuild"` is from experiment 35,
where parking on "unsure" would have stopped about one ordinary bug in six for
a person.

Three rules make the file safe to hand to someone.

**An empty file changes nothing.** Every key defaults to the value the code
held before the file existed. Every table can be left out. So turning config
on was a no-op, and I could check that with a test instead of trusting it.

**An unknown key is an error.** `flor = 0.9` under `[failure]` fails the load.
So does a table called `[falure]`. A config file that quietly ignores typos is
worse than no config file, because you think you changed something.

**A value out of range names the key.** `floor = 1.5` fails with
`failure.floor` in the message. `attempts = 0` fails, `attempts = 2.5` fails,
and `on_unsure = "ask"` fails, because "ask" isn't one of the two paths the
code has.

All of that is one zod schema in `src/settings.ts`, about 60 lines of it. TOML
is parsed first, then the same schema checks every value:

```ts
lane: z.strictObject({
  attempts: count.default(3),
}).prefault({}),
failure: z.strictObject({
  floor: floor.default(0.8),
  on_unsure: z.enum(["rebuild", "park"]).default("rebuild"),
  output_chars: count.default(20_000),
  diff_chars: count.default(20_000),
}).prefault({}),
```

`strictObject` is the typo rule. `default` is the empty-file rule. `floor` is
a number between 0 and 1, and `count` is a whole number above zero. That's the
whole trick, and you can copy it into any agent pipeline that has a number in
a prompt.
