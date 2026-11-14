---
date: "2026-11-06"
scripts: "none"
summary: "Today's version first; reading about 16 makers (POSIX, fish, Nushell, zsh, tmux, IRC, Slack, another chat tool, Claude Code, Codex, `llm`, Warp, WCAG, a radio call-up, a kitchen pass), plus one run of tsh's word splitter and parser on eight lines. Names are checked tokens refused on clash; an addressed line's rest is read by other rules; one parse feeds highlighting, completion and errors; model and effort are the harness's own words. Today `@claude ... #7 twice?` loses `#7 twice?` to the comment rule and is refused at its second word; `summon` is refused at its second word. Feeds the proposed summon guidelines note. $0."
---

# How should a shell summon agents by name, and what grammar does that need?

Read 2026-11-06. **This is reading, plus one small check run.** The check ran today's tsh word
splitter and parser (`packages/fabrika/src/shell/words.ts` and `grammar.ts`, main at `d3ac41eb`) on
eight lines with node 26.13; nothing else ran, no agent and no model, $0. It feeds
[summon guidelines](../docs/direction/summon-guidelines.md), a proposed note, and a Design canvas,
"Summon guidelines", that a second pass draws with step 5's builds. Today's version first (tsh in
`packages/fabrika/src/shell/`, the host and frame in `apps/fabrika/src/`); lessons for `next/`'s
fabsh second.

**The answer.** The makers agree on four things. A name is a token checked in one position, with a
fixed rule for its letters, and a name already taken is refused, never replaced in silence (IRC's
433, Erlang's `register`, tmux). Free words after an address are not shell words: the tools that do
it well switch how the line is read (Claude Code's `!`, a POSIX here-document), and the tools that
guess misfire (Warp). One parse feeds the highlighting, the completion and the error, so they cannot
disagree (fish, Nushell). And the model and effort are the harness's own words, checked against what
that model offers now, since both lists move (Claude Code, Codex, `llm`).

Today's `@claude` line follows none of this yet, because nothing of it is built. The line
`@claude why does post print #7 twice?` loses `#7 twice?` to the comment rule, takes `@claude` as a
program name, and is refused at `why` with a message about flags. `summon` is refused at its second
word the same way. The pieces to build it exist: tokens with positions, a did-you-mean, an `acp`
program that already takes `--model` and `--effort` and checks them against the harness's own list,
and a top bar item that already counts agents.

```text
how each tool names and addresses a helper, one line each
POSIX alias  a token in command position is swapped for its text; reserved words only "in certain positions"
fish abbr    a typed word expands "after pressing space or enter", on screen, before it runs
Nushell      "Type checks are a parser feature"; one signature gives the error and the completer
IRC          nickname grammar in the RFC; 433 "already in use" and 401 "No such nick" are two errors
Discord      a name regex, lower case where a letter has one; choices are "the only valid values"
Slack        unnamespaced slash commands: on a clash the last installed wins, in silence
Erlang/OTP   register(Name, Pid) fails when taken; Name ! Msg fails on an unknown name; one mailbox
Claude Code  --model takes an alias (sonnet, opus, haiku); --effort low to max; -r resumes by id or name
Codex        effort is what "the selected model" advertises; a profile is a saved bundle of settings
llm          `llm aliases set <alias> <model-id>`; a continued conversation keeps its model
tmux         a target is tried as an exact name, then a prefix; `=` asks for exact only
Warp         guesses shell or agent per line, labels it "(autodetected)", and admits misfires both ways
radio        the call names the station called, then the caller, in full on first contact
kitchen      the expo calls the ticket, the cook answers "heard", tickets wait on the rail in order
```

## What was read

About 16 public pages and nine files of today's code. A research agent fetched the pages on
2026-11-06 and returned short quotes through a page summarizer, so quotes are near-verbatim; the
lead agent fetched four more itself (Codex's config reference, `llm`'s aliases, POSIX 2.10). A claim
found only in search snippets is marked **secondary**, one found nowhere **guess**.

## Shells

| Source | What it says | What it teaches |
|---|---|---|
| POSIX [p1] | An alias is checked on a token in command position; "reserved words are not recognized except in certain positions in the input, such as after a <newline> or <semicolon>". A here-document's body "begins after the next <newline>", read by other rules. | A keyword like `as` is a keyword only in its slot. A line can switch how the rest is read, which is what `@name` needs. |
| bash [p2] | The Aliases page did not load. **Guess:** bash checks "the first word of each simple command". | Nothing beyond POSIX. bash replaces an alias in silence on redefinition, a known trap (**guess**, from use). |
| fish [f1] [f2] | Abbreviations are "user-defined words that are replaced with longer phrases when entered", "Only typed-in commands use abbreviations", and expansion "occurs after pressing space or enter". fish "interprets the command line as it is typed" and highlights "Non-existing commands". It suggests "based on command history, completions, and valid file paths". | Show what a short name means before it runs, and mark an unknown name while typing. |
| Nushell [n1] | "If you annotate a type on a parameter, Nushell will check its type when you call the function." "Type checks are a parser feature." "A custom completer belongs to the parameter, not the type." Errors read "Missing required positional argument". | One signature drives the error and the completion. A slot's completer is the slot's own. |
| zsh [z1] | `CORRECT`: "Try to correct the spelling of commands", and it "may falsely report spelling errors the first time some commands are used". The `_describe` part was not read. | A guess has false alarms: suggest, never run the guess. Today's `did-you-mean.ts` already keeps its bound tight for this reason. |
| tmux [t1] | A target session is tried as an id, then "An exact name of a session", then "The start of a session name", then a glob; with `=`, "only an exact match is accepted". | Prefix matching saves keys and picks wrong. An agent name that runs a paid turn wants exact match only. |

## Chat and bots

| Source | What it says | What it teaches |
|---|---|---|
| IRC [i1] | `nickname = ( letter / special ) *8( letter / digit / special / "-" )`, at most nine. `{}\|^` are the lower case of `[]\~`. 401 "No such nick/channel", 433 "Nickname is already in use". | A fixed name grammar, one case rule, and two different errors: unknown name and name taken. |
| IRCv3, `/msg` [i2] | Not fetched. | |
| Slack [s1] | Slash commands are not namespaced; on a clash "Slack will always invoke the one that was installed most recently". An app gets `app_mention` events. Acknowledge "within 3000 milliseconds". | Silent shadowing is a trap: refuse a second summon of a taken name. Acknowledge at once, then do the work. |
| Discord [d1] | Name regex `^[-_ʼ\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$`; "If there is a lowercase variant of any letters used, you must use those." Choices "are the only valid values". Autocomplete returns "option suggestions to a user as they type". | Lower case only, refused not folded. Fixed choices for a fixed list, a completer for a list that moves. |

## Agent command lines

| Source | What it says | What it teaches |
|---|---|---|
| Claude Code [c1] [c2] | `-r` resumes "by ID or name"; `-c` continues the latest. `--model` takes "a model alias such as `sonnet`, `opus`, `haiku`, or `fable`". `--effort` takes `low`, `medium`, `high`, `xhigh`, `max`, or `ultracode`. "If you set a level the active model does not support, Claude Code falls back to the highest supported level at or below the one you set." | Model and effort map straight onto `summon`'s two slots. The fallback is silent; ours should say it. |
| Codex [x1] | `exec resume` "by ID or add `--last`". A profile layers `$CODEX_HOME/profile-name.config.toml`. `model_reasoning_effort` is "Reasoning effort advertised by the selected model, such as low, medium, high, xhigh, max, or ultra." | Codex's top word is `ultra`, Claude's is `ultracode`: the words differ per harness, and the list is per model. A summon is close to a profile with a session. |
| `llm` [l1] | "`llm aliases set <alias> <model-id>`"; aliases let you "refer to a model by a short name". `--continue` "will automatically use the same model as the conversation"; `--cid` names one. | A conversation keeps its model. A model alias is a name for a moving target. |
| Warp [w1] | **Secondary.** Each line is labeled agent or shell, "(autodetected)"; "Prepend ! to your input to force it to run as a shell command"; misfires both ways. | Guessing costs. An explicit `@` never guesses (already in the settled note). |
| Our own [e158] | Experiment 158: Claude Code 2.1.296 reads `haiku` as `claude-haiku-5-5`, while 2.1.286 read it as Haiku 4.5, which "takes no effort". | The alias a person types and the model it meant must both be kept, at the summon. |

## Accessibility

| Source | What it says | What it teaches |
|---|---|---|
| WCAG 4.1.3 [a1] | Status messages "can be programmatically determined through role or properties such that they can be presented to the user by assistive technologies without receiving focus". Technique ARIA23 uses `role=log` for sequential updates. Assertive is for what is time-sensitive. | A turn's progress is a status; a reply is a log entry; neither moves focus. |
| MDN `log` [a2] | "Elements with the role `log` have an implicit `aria-live` value of `polite`"; updates "are announced when the user is idle". | Polite, never assertive. Streaming tokens into it would read every chunk. `aria-busy` was not read. |

## Outside software

- **Radio call-up** [o1], **secondary**: the call gives the "Name of the facility being called",
  then "Your full aircraft identification"; "Call signs should never be abbreviated on an initial
  contact", and when two call signs sound alike, control may ask one to use another. It teaches:
  the called name first, in full; a name too close to another is changed, not shared. What does
  not carry: radio has a person on each end to sort out a mistake.
- **A kitchen pass** [o2], **secondary**: the expo calls "ordering" and "fire"; the cook answers
  "heard"; tickets wait on the rail in order. It teaches: say "heard" at once, before the work, and
  keep the queue visible. Two calls to one cook queue, which is the settled one mailbox. What does
  not carry: a cook can be shouted at mid-dish; a turn is cancelled, not told.

The plain way they agree on: a name is a checked token in a known slot, taken names are refused,
the rest of an addressed line is read by other rules, one parse feeds every view of the line, and
the helper's own options are the helper's words. It clashes with no goal of ours. It clashes with
one settled line in today's version only in how it is built: `@` is "read off the line before
tsh's shell words" (decided 2026-11-05). The note keeps that, and writes it as one rule of the
grammar instead of a check before it.

## Today's `@claude` line

The running example is the line from the settled note and experiment 210, typed in today's tsh:
`@claude why does post print #7 twice?`, then the summon that starts it,
`summon claude haiku as scout`. The check ran each through `words` and `parse`:

```text
words() and parse(), today's version, main at d3ac41eb, node 26.13
"@claude why does post print #7 twice?"  words: @claude why does post print     "#7 twice?" eaten as a comment (words.ts:56-60)
                                         parse: refused at 8 "expected --flag value, input=value, >output or <input, not why"
"@claude what's wrong?"                  words: @claude · "whats wrong?" (a quote left open)
                                         parse: refused at 21 "a quote is not closed"
"@scout fix it & test it"                words: @scout fix it <&> test it
"summon claude haiku as scout"           parse: refused at 7 "expected --flag value ..., not claude"
"summon claude haiku as scout on cloud"  the same refusal, at 7
"@scout"                                 parsed: a run of a program named "@scout"; check.ts then says no program
```

| What | Today | Where |
|---|---|---|
| A line reaches tsh | The line door offers every typed line to tsh's run whole | `apps/fabrika/src/tsh.ts:708-716` |
| Tokens with positions | Every word and operator keeps `start` and `end` | `packages/fabrika/src/shell/words.ts:22-32` |
| `#` eats the rest | A word that starts with `#` ends the line | `words.ts:56-60` |
| `@claude` as a program | Only `-`, `<`, `>` and `=` are refused as a program name | `grammar.ts:180-186` |
| The refusal at `why` | A bare word after a program is not a flag or an input | `grammar.ts:245-249` |
| Built-ins | `jobs ps tell close stop attach programs help exit`; no `summon`, `dismiss`, `agents` | `grammar.ts:79-89` |
| Did you mean | One edit up to 3 letters, two above; never a guess past that | `did-you-mean.ts:7`, `:41-54` |
| Unknown program | "no program named X", guessed from programs and built-ins | `check.ts:183-184` |
| Completion | Words, then programs, flags, values, jobs; no `@`, no agent names | `complete.ts:42-50` |
| The agent program | `acp` takes `--agent` (`claude`, `codex` or `fake`), `--model`, `--effort`, `prompt`, `allow`, `refuse`, `cancel` | `packages/fabrika/src/agents/acp/program.ts:153-189` |
| Model and effort checked | Against the harness's own list, after the session opens: "model X is not one of: ..." | `agents/acp/client.ts:279-293`, `program.ts:367-369` |
| Reply shown | `said` once the turn ended; chunks are folded, not printed | `program.ts:195`, `agents/acp/transcript.ts:218-230` |
| A name's letters | An agent's writer name: `^[a-z0-9][a-z0-9._-]{0,63}$` | `packages/fabrika/src/host/door.ts:347-348` |
| Top bar | An `agents` item, counting agents attached over MCP, with a panel of rows | `apps/fabrika/src/window/frame.tsx:278-292`, `:603` |
| Screen text | The terminal's text is a named region, on purpose not live | `apps/fabrika/src/window/terminal.ts:87-92` |

Against the note's seven principles (S1 to S7):

| Principle | Today | |
|---|---|---|
| S1 one grammar, typed tokens | Half: tokens have positions; nothing gives a token a role, so no highlighting reads them | `words.ts:22-32` |
| S2 the words after `@name` are not shell words | Breaks: `#`, `'`, `\|`, `&` and `;` all act on prose | `words.ts:56-76` |
| S3 a name is a writer id, refused on clash | Half: the rule exists for writers; nothing names a summoned agent | `door.ts:347` |
| S4 the harness's own words, checked at summon | Half: checked, but only once a run has started | `client.ts:279-293` |
| S5 honest about where it runs | Passes by absence: nothing claims a place | |
| S6 a turn is a foreground job | Half: Ctrl-C stops the foreground job, and `acp` has `cancel`; the reply is not shown in tsh | `shell.ts:94-95`, `program.ts:188` |
| S7 see and end what you summoned | Half: the top bar counts attached agents; no `dismiss`, no `agents` | `frame.tsx:278-292` |

## What this tells us for fabrika

- **Write `@` as the first rule of the grammar, not as a check in front of it.** The decided
  "read before shell words" holds; the grammar says it, so highlighting and completion know where
  prose starts.
- **The slots of `summon` are typed, the values are the harness's.** The shell owns `summon`,
  `as`, `on` and `dismiss`; the harness owns `haiku` and `xhigh`.
- **Today's version can check the model and effort for free at the summon,** since opening an
  ACP session calls no model. It cannot honor `on`, since there is one Mac and no brain.
- **Keep the typed model and the resolved one.** Aliases move between CLI versions (experiment 158).

## What it cannot tell us

- Nothing was built and no person typed a summon. Whether two positional slots read well, or
  people want `--model`, is not known.
- No screen reader ran. How VoiceOver reads a reply landing in the terminal's text region is not
  known; the region is not live today, so it may say nothing at all.
- The quotes came through a page summarizer. bash's page, IRCv3, zsh's `_describe`, Nushell's
  parser page and `aria-busy` were not read. Warp and both outside fields are secondary.
- Whether opening an ACP session is free for every harness was read in code, not measured on a
  bill.
- How two people share names is reasoned from the settled note, not tried. Later the same night the
  owner decided part of it (another person's agent is `@scout/<person>`, talk yes, summon or
  dismiss no) and added named threads and forks. Later still, the owner walked the threads back: a
  talk is a room with members, people and agents, and an agent is mentioned in it (`#bug-17`, then
  `@scout`); a DM is a room of two; every room is readable by everyone on the project; several
  mentions answer in order. The `@scout/<person>` address went with it; talk yes, run no stayed. The
  note has all of it, with what was walked back marked. No maker was read for threads, rooms or
  forks: they are the owner's decisions, not this reading's findings.

$0. No model call, no key.

## Links

- [p1] POSIX Shell Command Language: https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html
- [p2] bash Aliases (did not load): https://www.gnu.org/software/bash/manual/html_node/Aliases.html
- [f1] fish `abbr`: https://fishshell.com/docs/current/cmds/abbr.html
- [f2] fish interactive use: https://fishshell.com/docs/current/interactive.html
- [n1] Nushell custom commands: https://www.nushell.sh/book/custom_commands.html
- [z1] zsh options: https://zsh.sourceforge.io/Doc/Release/Options.html
- [t1] tmux manual: https://man.openbsd.org/tmux
- [i1] IRC client protocol, RFC 2812: https://www.rfc-editor.org/rfc/rfc2812
- [s1] Slack slash commands: https://docs.slack.dev/interactivity/implementing-slash-commands and `app_mention`: https://docs.slack.dev/reference/events/app_mention
- [d1] Discord application commands: https://docs.discord.com/developers/interactions/application-commands
- [c1] Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- [c2] Claude Code model configuration: https://code.claude.com/docs/en/model-config
- [x1] Codex commands: https://learn.chatgpt.com/docs/developer-commands?surface=cli and config reference: https://learn.chatgpt.com/docs/config-file/config-reference
- [l1] `llm` usage: https://llm.datasette.io/en/stable/usage.html and aliases: https://llm.datasette.io/en/stable/aliases.html
- [w1] Warp universal input (secondary): https://docs.warp.dev/terminal/input/universal-input/
- [a1] WCAG 2.2 Understanding 4.1.3: https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- [a2] MDN `log` role: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/log_role
- [o1] FAA Aeronautical Information Manual, chapter 4 section 2 (secondary): https://www.faa.gov/air_traffic/publications/atpubs/aim_html/chap4_section_2.html
- [o2] Kitchen calls (secondary, restaurant and point-of-sale blogs found by search)
- [e158] [Experiment 158](./158-why-claude-wanders.md)
