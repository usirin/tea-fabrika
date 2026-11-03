# What game architectures teach fabrika

Read 2026-11-01, against `main` at `80d4a5b5`. A study by reading only: nothing was built or
run, and no model was called for it. Every outside claim has a link. Where a source is a summary
by someone other than the maker, the text says so.

## The answer

**Games already solved our crash recovery, and they solved it the same way our notes do: keep a
checkpoint, record what you cannot work out again, and replay the rest.** "You die, you respawn at
the last checkpoint, not level 1" is P4 of the [pipeline guidelines](../docs/direction/pipeline-guidelines.md),
nearly word for word.

- **They agree with us** on most of what is decided: resume from a saved state (P4, P6), a swap
  that waits for a safe point (hot reload H2), the box around programs, keys as data, and no
  timers on keys.
- **They challenge us in one place hardest:** saved state. Minecraft, Unreal, Factorio and Erlang
  all write an explicit version into what they save and run a chain of named, run-once upgrades.
  [An old host is named, then restarted](../docs/direction/an-old-host-is-named-then-restarted.md)
  decided the opposite: "No version number on each machine. The schema is the check."
- **The best single idea to take:** GGPO's "sync test", as a law every machine runs. At each
  step, save the model, load it back, go on, and check the result equals a run with no stop.
  It tests P4, P6, H2 and H3 with one helper.
- **Where the comparison breaks:** a game can re-run everything after a checkpoint because its
  code is deterministic and a frame costs microseconds. An agent step is neither. We can only
  re-run code; an agent's answer has to be recorded, the way a game records a button press.

```ts
// A sketch. One idea on both sides: a checkpoint, a record of what cannot be worked out again, a replay.
// A game (GGPO, Handmade Hero, League of Legends' server recordings):
//   checkpoint = save_game_state(frame 9000)
//   record     = each player's input per frame          (the one thing code cannot recompute)
//   respawn    = load_game_state(9000), then advance_frame over the recorded inputs
// fabrika (decided for next/; today's lane has part of it):
//   checkpoint = the saved Held at a stop (P6); the model kept across a swap (H2)
//   record     = facts: what a person said, what an agent drafted, what a check saw
//   respawn    = init from the saved model, fold the facts after it; a done key never runs again (P4, P7)
// Where they part: a game re-runs every frame after the checkpoint. We re-run code only.
// An agent's draft is a recorded input, like a player's button press, never re-rolled on replay.
```

**A note on our two versions.** `next/` is not on `main`. It lives on
[PR 223](https://github.com/usirin/tea-fabrika/pull/223), which is open. So below, "next/" means
what `docs/direction` decided for it, and nothing there is built unless the text says so.
"Today's" means the workspace packages (`packages/`, `programs/`, `apps/` and the rest). The
pipeline guidelines are written for today's lane first and for `next/`'s lane, not yet designed,
second.

## The map

| Topic | Mostly agrees with | Challenges | Idea to try | How sure of the idea |
|---|---|---|---|---|
| 1. Saves and checkpoints | P4, P6, H2 | "No version number on each machine" | A version and a chain of named upgrades | 70% |
| 2. Lockstep and replays | the ledger, the fold, P7 | D5's local copy, later | A first-divergence report | 75% |
| 3. Rollback and prediction | D3's `said` and `at`, `refuse` | nothing decided | `seen`: the rev a writer had read | 75% |
| 4. Hot reload | H1 to H5 | H2's kept model, a little | A mark when `init` changed | 70% |
| 5. ECS and data-oriented design | the data-shape rule, Cmds | P7's hand-listed key | A step declares what it reads | 70% |
| 6. Game loop and job systems | the mailbox, Effect fibers | nothing | none worth the cost now | n/a |
| 7. Game AI | control in code, the six moves | the hand-written route table, later | Preconditions and effects per step | 65% |
| 8. Crash reports and telemetry | record wide, P6 | nothing | merged into idea 2 | n/a |
| 9. Modding and sandboxes | programs run in a box | nothing | A time budget per step | 60% |
| 10. Input remapping | K1 to K9, M4 | nothing | A no-chord preset | 60% |

## 1. Save systems and checkpoints

### What games do

- **Every save carries its version, and old saves are upgraded by a chain of fixes.**
  - Minecraft writes a "data version", "a positive integer used in a world saved data to denote a
    specific version", into every saved file and every chunk
    ([Minecraft Wiki, data version](https://minecraft.wiki/w/Data_version)). Its maker published
    [DataFixerUpper](https://github.com/Mojang/DataFixerUpper), "created for converting the game
    data for Minecraft: Java Edition between different versions of the game". A world is upgraded
    one version step at a time, by fixers keyed by those numbers (my reading of the library; its README says only what it is
    for).
  - Unreal Engine pairs "a unique GUID key with an int32 version number" for each subsystem's
    saved data, and saves the set of versions with the asset
    ([FCustomVersion](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Core/FCustomVersion),
    [FCustomVersionContainer](https://dev.epicgames.com/documentation/unreal-engine/API/Runtime/Core/FCustomVersionContainer)).
    As I read it, the GUID key lets each part of the engine bump its own number.
  - Factorio's migrations "fix up a save file which was used in an older version of the game or
    mod". Each save keeps the names of the migrations already applied, so none runs twice, and they
    run in a fixed order ([Factorio API, migrations](https://lua-api.factorio.com/latest/auxiliary/migrations.html)).
  - Erlang, which our hot reload note cites, does the same at the process level. `code_change`
    gets `OldVsn`, "defined by the `vsn` attribute(s) of the old version", and "if no such
    attribute is defined, the version is the checksum of the Beam file"
    ([gen_server](https://www.erlang.org/doc/apps/stdlib/gen_server.html)).
- **A save can happen at any moment, so state is kept ready to save.** Xbox gives a title that is
  being suspended one second to save on Xbox One, and says a suspend can come "virtually at any
  time" ([GDK game saves best practice](https://learn.microsoft.com/en-us/gaming/gdk/docs/features/common/game-save/game-saves-best-practice)).
  Microsoft's safe-write recipe: write a temporary file, close it, then replace the old save
  atomically ([GDK walkthroughs](https://learn.microsoft.com/en-us/gaming/gdk/docs/features/common/game-save/game-saves-walkthroughs-and-samples)).
- **An autosave must not stop play.** Factorio's asynchronous save "works by using the fork
  syscall to essentially duplicate the game", and the child writes the save while the game runs on.
  It stays a hidden setting: it "requires a significant amount of RAM" and has an unsolved freeze
  ([FFF 408](https://factorio.com/blog/post/fff-408)).
- **Quicksave against checkpoint.** A quicksave is the player's choice of moment; a checkpoint is a
  moment the designer chose as safe. I found no maker's write-up of how a checkpoint picks its
  moment, only fan and forum accounts, so I do not lean on any.
- **Save only what persists, then rebuild.** Godot's guide saves only nodes in a "Persist" group,
  and loading first deletes them so it is "not cloning objects during loading"
  ([Godot, saving games](https://docs.godotengine.org/en/stable/tutorials/io/saving_games.html)).

### Which of our notes it agrees with

- **P4, resume never redo, and P6, every stop saves what a resume needs** (decided, today's lane
  first). Respawning at the last checkpoint is P4. Saving before the stop is written is Xbox's "keep
  state ready to save".
- **Every `done` is a checkpoint chosen by code, and a person's `stop` is a save and quit.** P4's
  first clash with Linear made a person's stop a saved pause. That is a game's "save and quit": it
  waits for the next safe point and keeps everything.
- **H2, the swap waits its turn** (next/, decided). A swap between two Msgs is a save at a safe
  point. Experiment 183 showed what a save at an unsafe point does: the counter became `null` in 5
  of 5 runs.
- **D2 and D3, the ledger** (next/, decided). An append-only log inside one object never writes over
  a save, so Microsoft's temp-then-replace recipe is not needed; the log is the safe write.
- **Godot's "save only what persists"** is our "two places for records": facts in the ledger, health
  signals in monitoring.

### Where it challenges a decision

- **[An old host is named, then restarted](../docs/direction/an-old-host-is-named-then-restarted.md)**
  (decided 2026-10-25, 85%, built in today's version on 2026-10-26) says: "No version number on each
  machine. The schema is the check. A version only matters if old state must be carried forward, and
  tea's `upcast` is the place for that, when it comes."
- **[Hot reload H3](../docs/direction/hot-reload.md#h3-a-new-shape-migrates-or-that-one-process-is-refused)**
  (next/, decided, 85%) then carries old state forward, with an upcast that guesses the old shape by
  its fields: `isRecord(raw) && "n" in raw ? {count: raw.n} : raw`.
- **What games would undo:** the "no version number" line, for any state that is carried forward.
  Three reasons, each from the sources above:
  - **A shape guess breaks when two shapes look alike.** A version number does not guess.
  - **A process can skip versions.** H3 keeps a refused process on its old code. When it swaps
    later, it may be three shapes behind. A chain keyed by number (Minecraft, Unreal) runs each step
    in order. One upcast "from the shape before it" cannot.
  - **Which upgrades ran is a fact lost if not written now.** Factorio records each migration by
    name in the save. Our own data-shape rule asks exactly this question.
- **What it would keep:** the schema stays the check, as Elm's decoder is. The version only picks
  which upgrade runs first. Erlang's fallback, a checksum when no version is set, is what our
  `build` hash already is (H6), so a hash alone is Erlang's answer for code that never planned an
  upgrade. A hash cannot be put in order, though, so it cannot pick a chain.

### Idea worth trying: a version and a chain of named upgrades

```ts
// A sketch for next/. The saved model carries its shape's number. The program lists its upgrades.
type Saved = {readonly v: number; readonly model: unknown};
const counter = {
	state: Schema.Struct({count: Schema.Number}), // still the check, after the chain
	v: 3,
	upgrades: {
		1: (m: {n: number}) => ({count: m.n}),            // "n-to-count"
		2: (m: {count: number}) => ({count: m.count, step: 1}),
	},
};
// load {v: 1, model: {n: 7}}: runs 1, then 2, then decodes. Writes:
// {_tag: "state.upgraded", body: {program: "counter", from: 1, to: 3, ran: ["1", "2"]}}
```

- **Why:** every engine read here does it, and it closes the two gaps above. The fact of which
  upgrades ran cannot be rebuilt later.
- **Cost:** a number beside each saved model, a map of upgrades, one fact, and a law that a chain
  run from any old number decodes. About 60 to 100 lines with tests in `next/`'s core, under 1 agent
  hour. Today's version could keep its rule until its code goes.
- **How sure: 70%.** The doubt: in Tier 1, states are small and processes short-lived, so a schema
  check alone may be enough for a long time. What would settle it: count, through Tier 1, how many
  state shape changes a program had, and whether any process ever swapped more than one shape at
  once.

## 2. Deterministic lockstep, input replays and replay files

### What games do

- **Send the inputs, not the state.** Age of Empires ran "the exact same simulation on each
  machine". Turns "were typically 200 msec in length", and "commands issued during turn 1000 would
  be scheduled for execution during turn 1002"
  ([1500 Archers on a 28.8](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond)).
  Factorio is the same: "only the action is somehow transferred to all other players"
  ([FFF 76](https://factorio.com/blog/post/fff-76)).
- **Determinism is the whole cost.** "Very subtle differences would multiply over time," and the
  Age of Empires team "check-summed the world, the objects, the pathfinding, targeting and every
  other system" and still chased sync bugs to the wire (same article). Floating point makes it
  "almost impossible to guarantee determinism" across compilers and chips
  ([Gaffer On Games, deterministic lockstep](https://gafferongames.com/post/deterministic_lockstep/)).
- **A desync is caught, reported and healed.** In Factorio a client that detects a desync
  disconnects, downloads the server's state again, and writes a report that "contains both the
  player's and server's copy of the save game" plus the log. The report "does not state the cause"; it
  is a record of the state at the time. "In most cases when desyncs occur and mods or scenarios are
  being used they are the cause" ([Factorio wiki, desync](https://wiki.factorio.com/Desync)).
- **A replay file is the start plus the inputs.** "Given an initial state and a list of events, the
  end state can be exactly replicated" ([sc2reader, what is in a replay](https://sc2reader.readthedocs.io/en/latest/articles/whatsinareplay.html),
  a third-party reader of the format). StarCraft replays keep only each player's starting units, and
  every action is re-played ([Liquipedia, replays](https://liquipedia.net/starcraft/Portal:Beginners/Replays)).
  The catch: a replay needs the code that recorded it. The sc2reader page lists the patch as a
  dependency of the replay. I found no maker's statement of how old replays are kept playable.

### Which of our notes it agrees with

- **The ledger is the input stream and the fold is the simulation**
  ([markdown is a view](../docs/direction/data-first-markdown-is-a-view.md), decided; today's and
  next/). State is folded from facts on every read. That is a replay file read on every frame.
- **What we record is what code cannot recompute.** A game records only inputs because everything
  else is deterministic. Our facts include an agent's draft and a check's result for the same
  reason: they are our uncontrolled inputs. That is the honest version of lockstep for agents, and
  it is what "record wide" and the data-shape rule already ask.
- **P7's key is a checksum of a step's inputs** (decided, today's lane first, 75% on the hash).
  Age of Empires checksummed the world to catch a split. P7 hashes the inputs to skip a step whose
  inputs did not change.
- **H6's `build` on every record** (next/, decided, 90%) is what a replay file needs: the code that
  wrote it. Worker Loader loads code by content hash (experiment 173), so an old build can still be
  loaded to replay what it wrote.

### Where it challenges a decision

- **Nothing decided today.** One later decision will meet it: **D5, a local read copy on each
  client, "later"** ([the five layers](../docs/direction/a-local-first-sync-engine.md#layer-2-data-decided-2026-10-30)).
  A local copy is lockstep: each client folds the same facts and must get the same view. T4 lets the
  brain speak the current and the previous protocol version, so two clients can run two builds at
  once. That is the Factorio desync, waiting. D5 should come with a check that two folds at one rev
  agree, and a report when they do not.

### Idea worth trying: a first-divergence report

- **What:** when two folds that should agree do not, write one bundle and say where they first
  part. Two cases exist now in today's version: P6's law that the fold of a lane's facts equals its
  saved `Held`, planned for today's lane in PR 289, and `replay/` runs of old tickets. One more comes with D5 in `next/`.
- **The known way:** Riot made League of Legends' server deterministic so a recording could
  "restore the server to the exact state it was in at an earlier time". It began as "a desire to
  create fast, repeatable tests driven from a set of recordable inputs"
  ([Riot, determinism introduction](https://www.riotgames.com/en/news/determinism-league-legends-introduction)).
  It finds a split by comparing two runs, logging state as key-value pairs only "on frames where the
  value changes", because "only the first divergence really matters", and it replays "2-3 thousand
  real-world games per day" ([Riot, fixing divergences](https://www.riotgames.com/en/news/determinism-league-legends-fixing-divergences)).
  They chose logs over checksums because a checksum says that a split happened, not where.
- **Cost:** 100 to 200 lines over facts that already exist, 1 to 2 agent hours.
- **How sure: 75%.** The doubt: how often the fold and `Held` will disagree on real lanes. If never,
  the report is insurance, not a tool. PR 289's law will show how often.

## 3. Rollback netcode, prediction and reconciliation

### What games do

- **Rollback (GGPO).** "Game logic is allowed to proceed with just the inputs from the local
  player." When the remote inputs arrive and differ from the guess, "the game can be re-simulated
  from the point of divergence to the current visible frame" ([ggpo.net](https://www.ggpo.net/)). The
  SDK's developer guide, in the repository that page links to, asks for three callbacks: save the state, load it,
  and advance one frame. It says "the game simulation must be fully deterministic", and offers a
  sync test: "GGPO will execute a 1 frame rollback for every frame of your game" and "raises an
  error if they differ".
- **Prediction and reconciliation (Valve, Source).** The client applies its own input at once; the
  server's answer is the truth, and a wrong guess is corrected, which "can be quite noticeable"
  ([Source Multiplayer Networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking)).
  The client predicts only its own movement. Other players are drawn about 100 ms in the past by
  interpolation.
- **Lag compensation is "what the shooter saw", worked out and bounded by the server.** The server
  rewinds other players to where the shooter saw them, keeps one second of history by default, and
  `sv_maxunlag` caps how far back it goes ([Valve, lag compensation](https://developer.valvesoftware.com/wiki/Lag_Compensation)).
  Valve's 2001 paper on the method is on the same wiki
  ([Latency Compensating Methods](https://developer.valvesoftware.com/wiki/Latency_Compensating_Methods_in_Client/Server_In-game_Protocol_Design_and_Optimization)).
  Both pages refused my reader, so these points come from search summaries of them, not my own read.
- **Overwatch** says it uses an ECS and "leverages determinism to achieve responsiveness and
  precision" ([GDC Vault](https://gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and)).
  I did not watch the talk. What I found on its prediction and rollback is second hand, so I use none
  of it.

### Which of our notes it agrees with

- **D3, two clocks** (next/, decided). Games never let a client's clock decide either. Valve trusts
  what the client saw only through what the server can check, and only within a bound. That is
  `said` kept out of the referee's types and `at` deciding.
- **A program may say no** ([Elm first](../docs/direction/elm-first.md), next/, decided). A Msg from
  a window that may be out of date gets a pure `refuse`. That is a server rejecting a client's
  prediction.
- **D4, poke then pull, and T7, catch up by rev.** A reconnecting client asks for everything after
  the last rev it saw. That is a client resyncing to the server's last acknowledged frame.
- **Central first.** Valve predicts only the player's own movement and never the world. If
  `next/`'s window ever needs to guess for speed (experiment 143's typing bar), the games' answer is
  to guess only its own Msgs and fold again at the brain's rev. This is a guess for later, not a
  plan.

### Where it challenges a decision

- **None.** Rollback itself does not fit us: it works because a frame costs microseconds and the
  code is deterministic. We would only ever roll back code, never an agent step.

### Idea worth trying: `seen`, the rev a writer had read

```ts
// A sketch: D3's entry with one more field. The writer says it; the referee can check it.
{id: "e-91", stream: "build:7", rev: 412, at: "23:12:04", by: "mac@owner", said: "23:10:01",
 seen: 409, // the last rev this writer had read when it wrote; the referee refuses seen > its own head
 _tag: "comment", body: {text: "also fix the label"}}
```

- **Why:** lag compensation decides with what the client saw, as a number the server can bound. Our
  data-shape rule lists "what they saw" among the facts that exist only at write time, and D3 has no
  field for it. `seen` answers "was this written against old news?" for a comment, an approval or a
  `refuse`, without trusting a clock. Unlike `said`, the referee can check it: it may not exceed the
  log's head, and a lie only makes the writer look staler. Today's ledger has a cousin,
  `appendAfter` ("add only if the ledger still ends where you last read",
  [ledger behind a service](../docs/direction/ledger-behind-a-service.md)), which uses the same
  number to decide but does not keep it.
- **Cost:** one field in D3, filled by the client's own read loop, and one referee check. About 20
  to 40 lines with a test. It costs most if it is added after Tier 1's first entries, since those
  can never get it.
- **How sure: 75%.** The doubt: P5's clash 2 already records `during`, the run that was live, for
  comments. `seen` may be one more field that nothing reads for a long time. "Record wide" says
  record it anyway, and the owner should weigh it before Tier 1 writes real entries.

## 4. Hot reload in engines

### What games do

- **Unreal Live Coding** "can rebuild your application's C++ code and patch its binaries while the
  engine is running". Its main catch: "values set in the constructor implemented in the `.cpp` file
  will not update in existing instances of objects", and a layout change without Object
  Reinstancing "will behave unpredictably"
  ([Unreal, Live Coding](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-live-coding-to-recompile-unreal-engine-applications-at-runtime)).
- **Unity resets by default.** "By default Unity reloads the domain on entering Play mode to reset
  the application state." Turning that off is faster, and then you "must then manually reset state
  in your code" ([Unity, domain reloading](https://docs.unity3d.com/6/Documentation/Manual/domain-reloading.html)).
- **Godot** reloads a saved script into the running game with "Synchronize Script Changes"
  ([Godot, debugging tools](https://docs.godotengine.org/en/stable/tutorials/scripting/debug/overview_of_debugging_tools.html)).
- **Handmade Hero** keeps all game memory in the platform layer and the code in a DLL, so reloading
  is swapping the DLL ([day 21](https://guide.handmadehero.org/code/day021/)). Then it adds looped
  editing: press L to record the input stream and a snapshot of game state, and the game replays
  that loop forever while you edit the code
  ([day 23](https://guide.handmadehero.org/code/day023/), "Implementing recording of game state",
  "Successful looped editing demonstration").

### Which of our notes it agrees with

- **[Hot reload](../docs/direction/hot-reload.md) H1 to H5** (next/, decided). Handmade Hero's split,
  state in one place and code in another, is H2's "the model stays; update and view change", and
  H5's "what survives a reload is what lives outside the part that restarts". Unreal's reinstancing
  rule for a layout change is H3's refuse-or-upcast. A bad save never taking over (H4) matches
  every engine read: none runs code that failed to build.

### Where it challenges a decision

- **H2 keeps the model by default; Unity's default is the opposite.** Unity resets on purpose,
  because kept state hides stale-value bugs. H2's decode check covers the shape. It does not cover
  meaning, and it does not cover `init`. Unreal's constructor catch is our case: change `init` from
  `{count: 0}` to `{count: 10}`, save, and a running counter keeps its 7. The person sees no change and
  thinks the save failed. This does not undo H2, which the owner decided and Elm and Erlang back. It
  adds one line to H6.

### Idea worth trying: say when `init` changed

- **What:** at load, `dev.ts` compares the new `init` with the old one. If they differ, the tile's
  quiet mark says so: `new code: init changed; Restart to see it`. Optional, after that: Handmade
  Hero's loop, where `dev.ts` replays the last few Msgs from a snapshot on the new code.
- **Why:** it is the one surprise every engine with kept state warns of, and it costs a hash.
- **Cost:** a hash of `init`'s value and one more word on H6's mark, under 30 lines. The loop is
  bigger, 150 to 250 lines, and waits for a real wish.
- **How sure: 70%** on the mark. 50% that the loop is worth building; one week of live editing in
  Tier 1 would tell.

## 5. ECS and data-oriented design

### What games do

- **Data and behavior apart.** Bevy's entities are "assigned groups of Components", components are
  plain structs, and systems are "normal Rust functions". It says the split "encourages clean,
  decoupled designs" ([Bevy, ECS](https://bevy.org/learn/quick-start/getting-started/ecs/)).
- **A system declares what it reads and writes, and the scheduler uses that.** In Bevy, "systems
  run in parallel by default whenever possible", because each system's parameters say which data it
  touches; `chain` forces an order (same page).
- **Structural changes wait for a sync point.** Unity's entity command buffers record changes such
  as creating an entity or adding a component, and "none of the changes recorded in an
  EntityCommandBuffer are enacted until its Playback method is called"
  ([Unity Entities, command buffers](https://docs.unity3d.com/Packages/com.unity.entities@0.51/manual/entity_command_buffer.html)).
  The point is to turn "multiple sync points spread across the frame to a single sync point"
  ([sync points](https://docs.unity3d.com/Packages/com.unity.entities@0.6/manual/sync_points.html)).
  These are old package versions; I did not check the 1.x docs.
- **Overwatch** "leverages ECS to curtail complexity"
  ([GDC Vault](https://gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and)). The rule
  often quoted from the talk, components have no behavior and systems have no state, plus
  "singleton components" for world-wide data, reached me only through
  [libraries that cite it](https://opensource.adobe.com/lagrange-docs/user/ui/ecs).

### Which of our notes it agrees with

- **Elm is ECS's cousin.** A tea model is data with no methods; `update` is a function. A Cmd
  returned from `update` and done after it is Unity's command buffer played back at a sync point.
  C1's "one write, or none" is that sync point for coordination.
- **The data shape comes first** (AGENTS.md). Data-oriented design says the same: the shape of the
  data drives the code.
- **[An object class stays thin](../docs/direction/object-classes-stay-thin.md)** (next/, decided).
  ECS has no fat objects either.
- **Every table except the log is a view** (D6). ECS keeps flat tables and queries across them; our
  views are flat too. Elm nests models in a tree of parents, and that tree is our process tree.

### Where it challenges a decision

- **P7's key is a list someone writes by hand.** P7's doubt says it plainly: "an input left out of
  the key" makes a stale answer look fresh. In Bevy a system cannot touch data it did not declare,
  so its declaration is complete by force. Our key is complete only if a person remembered every
  input. This does not undo P7. It changes where the list comes from.

### Idea worth trying: a step declares what it reads

- **What:** each step's reads are typed services it names up front, as a Bevy system's parameters
  are. The key is built from that list, and a read through a service not on the list fails. In Effect
  terms, the step's requirements are the list.
- **Why:** it removes P7's main risk, and P7's own property test ("changing any input changes the
  key") falls out of it.
- **Cost:** a declaration per step and a wrapper that records each read. 100 to 200 lines in
  today's pipeline, 2 to 3 agent hours. It may fit `next/`'s lane better, which is not designed yet.
- **How sure: 70%.** The doubt: an agent step reads files it picks itself, so its reads cannot all
  be declared. For agent steps the key stays a hand list of what the brief named, and P7's hand test
  stays. It merges with section 7's idea: reads are a step's preconditions.

## 6. The fixed-timestep game loop and job systems

### What games do

- **Fixed timestep.** The game loop's aim is to "decouple the progression of game time from user
  input and processor speed", and a fixed step keeps a game from becoming "non-deterministic and
  unstable" ([Game Programming Patterns, game loop](https://gameprogrammingpatterns.com/game-loop.html)).
  "The renderer produces time and the simulation consumes it in discrete dt sized steps". Falling
  behind leads to the "spiral of death", so a game clamps how many steps it runs to catch up
  ([Gaffer On Games, fix your timestep](https://gafferongames.com/post/fix_your_timestep/)).
- **Job systems.** Naughty Dog's GDC 2015 talk covers "the fiber-based job system Naughty Dog adopted
  for the game, the overall frame-centric engine design, the memory allocation patterns used in the
  title, and our strategies for dealing with locks"
  ([GDC Vault](https://gdcvault.com/play/1022187/Parallelizing-the-Naughty-Dog-Engin)). I could not
  open the slides, so I do not claim their details.

### Which of our notes it agrees with

- **Our machines have no tick, and that is right for us.** Time reaches a tea machine as a Msg from a
  Sub, "two clocks at once is two entries in the list of Subs" ([Elm first](../docs/direction/elm-first.md)).
  A game ticks because physics needs a fixed step. A lane waits on people, agents and CI.
- **One object handles one call at a time** (D1). That is the actor answer to locks, not the job
  answer. Effect's own runtime is fibers, so `next/` already sits on what Naughty Dog built by hand.
- **Decoupled time in tests.** Hot reload's laws are fast-check properties with fixed seeds. That is
  the fixed step's gift to games: a run you can repeat.

### Where it challenges a decision

- **None.** The one live lesson is the spiral of death: a client that wakes up thousands of revs
  behind (T7) should catch up without blocking keys. That is a guess, and nothing has measured it.

### Idea worth trying

- None worth the cost now. This is where the comparison breaks most: a frame is 16 ms and every
  frame runs; a lane step is minutes and most of the time nothing runs.

## 7. Game AI for bounded agents

### What games do

- **F.E.A.R.: a tiny state machine plus a planner.** "The FSM for characters in F.E.A.R. has only
  three states", Goto, Animate and UseSmartObject. "FSMs are procedural, while planning is
  declarative." Each action has preconditions and effects, and A* searches for the cheapest chain to a
  goal. The reason: "it is the complexity of the combination and interaction of all of the behaviors
  that becomes unmanageable." When a plan fails, the character records why in a shared working
  memory and plans again
  (the paper for [Three States and a Plan, GDC 2006](https://gdcvault.com/play/1013282/Three-States-and-a-Plan)).
- **F.E.A.R.'s squads are a coordinator.** A global coordinator finds characters to "fill required
  slots", makes sure "other A.I. are not ordered to go to the same node", sends orders, and "monitors
  the progress". A character weighs an order against its own goals: "fleeing from danger may trump
  following an order to advance" (same paper).
- **Halo 2: behavior trees, binary choices, no dithering.** Halo 2 moved from float scores to
  "making relevancy a binary test", walks "a prioritized list of the children. The first one that can
  run, does", and gives "the previous tick's winner ... an added bonus to avoid dithering"
  ([Handling Complexity in the Halo 2 AI](https://www.gamedeveloper.com/programming/gdc-2005-proceeding-handling-complexity-in-the-i-halo-2-i-ai)).
- **Utility AI** scores options with response curves, to avoid the harsh jumps of an if-then
  ([Improving AI Decision Modeling Through Utility Theory, GDC Vault](https://gdcvault.com/play/1012410/Improving-AI-Decision-Modeling-Through)).

### Which of our notes it agrees with

- **[Control lives in code](../docs/direction/control-in-code.md)** (decided, both versions). F.E.A.R.'s
  planner is code, not the character. The character picks nothing outside a closed list of actions
  whose effects are known. That is "limit outputs, not process" and the six moves.
- **The factory is one thin coordinator** ([Elm first](../docs/direction/elm-first.md)). F.E.A.R.'s
  squad coordinator fills slots, never sends two to one node, and watches progress: claims, leases and
  the lane, in 2006.
- **A character may turn down an order.** That is our `refuse` and an agent's `ask`.
- **Halo 2's anti-dithering bonus is P8's round bound.** Both stop a loop that flips back and forth.
  Halo 2's turn from floats to binary tests matches our habit of narrow yes or no Judge questions
  ([sort answers yes or no](../docs/direction/sort-answers-yes-or-no.md)).

### Where it challenges a decision

- **The route table is written by hand, and F.E.A.R. says that stops scaling.** The pipeline
  guidelines' "How a stop routes" table and P4's resume rule are hand-written transitions. Experiment
  186 found that the self-fix plan on PR 289's branch falls back to "a fresh lane on ticket 117, every step again"
  when the fold cannot prove a field. F.E.A.R.'s answer would be to search backward from the goal for
  the first missing effect.
- **What it would undo, if taken all the way:** "parents are written by hand" in
  [Elm first](../docs/direction/elm-first.md). I do not recommend that. A hand-written parent can still
  read declared preconditions and effects to find where to resume, without a planner choosing the
  route.

### Idea worth trying: preconditions and effects per step

```ts
// A sketch for today's lane, then next/'s. Each step says which facts it needs and which it writes.
const build = {needs: ["plan.approved", "exam.written"], writes: ["build.head", "checks.run"]};
const review = {needs: ["build.head", "checks.green"], writes: ["review.verdict"]};
// resume = the earliest step one of whose `writes` has no fact with a matching key (P4, P7)
// a law: every `needs` is some earlier step's `writes`, so the route table has no hole
```

- **Why:** it turns P4's "run again only from the earliest step whose output cannot be proved"
  into a lookup, and it checks the route table instead of trusting it.
- **Cost:** a declaration per step and two laws. 150 to 250 lines in today's pipeline, 2 to 4 agent
  hours, best done inside PR 289's plan rather than beside it.
- **How sure: 65%.** The doubt: today's facts may not map one to one onto effects, and some
  effects live on GitHub, not the ledger. Listing the twelve steps' needs and writes by hand first,
  about 1 agent hour, would settle whether the map is clean.

## 8. Crash reporting and telemetry

### What games do

- **Meter everything, always.** Age of Empires' lesson list: "Metering is king." It should "be low
  impact and kept running all the time", "be human readable and understandable by testers", and
  "reveal bottlenecks, slowdowns, and problems"
  ([1500 Archers](https://www.gamedeveloper.com/programming/1500-archers-on-a-28-8-network-programming-in-age-of-empires-and-beyond)).
- **A crash comes with what you need to replay it.** Riot's recordings hold "a complete record of the
  inputs, match settings, and configurations used to play the game"
  ([Riot](https://www.riotgames.com/en/news/determinism-league-legends-introduction)). Factorio's
  desync report carries both saves and the log ([wiki](https://wiki.factorio.com/Desync)).
- **Record on change, to keep it cheap.** Riot logs a variable only "on frames where the value
  changes" ([Riot](https://www.riotgames.com/en/news/determinism-league-legends-fixing-divergences)).

### Which of our notes it agrees with

- **Record wide** (AGENTS.md, decided 2026-11-01). "Kept running all the time" and "low impact" are
  our two limits on it, in 2001.
- **P6, the evidence exists only at the moment of the run.** A crash report is P6's evidence.
- **[A job record holds its trace](../docs/direction/a-job-record-holds-its-trace.md)** and "two places
  for records": decisions in the ledger, health in monitoring. Games split the same way, a replay and a
  crash dump.

### Where it challenges a decision

- **None.** "Record on change" is a way to keep record wide inside its own limit, not a change to it.

### Idea worth trying

- Merged into section 2's idea: a stuck lane's bundle and a fold mismatch are the same report, Factorio's
  desync report shape.

## 9. Modding and sandboxing

### What games do

- **Factorio** gives each mod "their own Lua instance" with its own global table at runtime
  ([data lifecycle](https://lua-api.factorio.com/1.1.0/Data-Lifecycle.html)). Mods are the usual
  cause of desyncs ([wiki](https://wiki.factorio.com/Desync)).
- **Roblox's Luau** is built for "untrusted (and in Roblox's case, actively malicious) code". The `io`
  library "has been removed entirely", `os` keeps only time functions, every library and the global
  table are read-only, and each script gets its own global table, so "all scripts are isolated from
  each other". A host can "terminate any script externally", and Studio's watchdog "limits the
  runtime of any script in Studio to 10 seconds". For stronger guarantees, "load trusted and untrusted
  code into separate VMs" ([Luau, sandboxing](https://luau.org/sandbox)).

### Which of our notes it agrees with

- **[Programs run in a box](../docs/direction/programs-run-in-a-box.md)** (decided 2026-10-24). "A
  machine never does anything itself: it returns Cmds", and "the app decides what crosses, never the
  program." That is Luau's empty `io` plus a host that owns every power. Worker Loader's one isolate
  per version (experiment 173) is Luau's separate VMs.
- **H6's `build` on every record.** Factorio's first question after a desync is "which mod". Ours
  is answered by the record itself.

### Where it challenges a decision

- **None.** One gap: Luau bounds time. Our [limits](../docs/direction/a-local-first-sync-engine.md#layer-3-coordination-decided-2026-10-31)
  count money, turns, seconds and tokens for agents. I found nothing that bounds how long one pure
  `update` may run inside the project object, which handles one call at a time. A step that loops
  forever would stall every client of that project. I did not check Cloudflare's CPU limits for this
  case.

### Idea worth trying: a time budget per step

- **What:** measure each step's time and record it (record wide), then refuse a program whose step
  passes a bound, the way Luau's interrupt does.
- **Cost:** recording is a field; the bound needs data first. 40 to 80 lines.
- **How sure: 60%.** The doubt: workerd may already end a runaway call, which would make this a
  record and not a guard. A ten-line probe with an endless `update` in Miniflare settles it.

## 10. Input remapping as an accessibility norm

### What games do

- **The Game Accessibility Guidelines** rank remapping as Basic: "remappable controls are one of the
  best value accessibility features". Presets "cannot provide for all needs, so ideally offer both",
  and prompts should "reflect the current mapping"
  ([GAG, remapping](https://gameaccessibilityguidelines.com/allow-controls-to-be-remapped-reconfigured)).
- **Xbox Accessibility Guideline 107** asks for in-game remapping of "all of the controls", "the Esc
  key on PC games" included. It prefers remapping actions over buttons ("remap game actions instead of
  individual game controls"). It says the new mapping must show "across any hints, tips, tutorials".
  It says a UI "should be navigable by using single, non-simultaneous key presses", and to avoid holds
  and two buttons at once ([XAG 107](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/107)).

### Which of our notes it agrees with

- **[Keybindings are configurable](../docs/direction/keybindings-are-configurable.md)** (next/,
  decided). K1, every binding is data, written command to key: XAG's "remap actions". "One table,
  shown everywhere": prompts reflect the mapping. "Losing a key never loses a command": every command
  is also in the palette. "No timers": XAG's no holds.
- **[Modes](../docs/direction/modes.md) M4, you always get out,** and the load refusing a file with no
  way out (WCAG 2.1.2). XAG lets even Esc move; we let every key move but keep one way out. That
  agrees with XAG's aim, so it is not a clash.

### Where it challenges a decision

- **None.** The one rub is the prefix: `ctrl+b` then a key is a chord, two keys at once. Experiment
  182 already weighed Sticky Keys. The prefix is a setting (K5), so a person can pick another.

### Idea worth trying: a no-chord preset

- **What:** ship one named preset next to the default whose prefix is a single key, and test it with
  Sticky Keys on. GAG's "presets and full remap, ideally both".
- **Cost:** one TOML file and a test, under 1 agent hour, in Tier 2 with the keys program.
- **How sure: 60%.** The doubts: I did not check whether K5 accepts a single key with no modifier as
  the prefix, and a single-key prefix takes that key from every terminal tile. Nobody has asked for it
  yet; a real screen with Sticky Keys and a switch user would tell.

## The ideas most worth a guidelines process, ranked

1. **A sync test law for every machine** (from GGPO). One test helper for `next/`'s kit: for any Msg
   list (fast-check, fixed seed), at every step encode the model, decode it, go on, and compare with
   the run that never stopped. It holds P4 and P6 (resume), H2 and H3 (swap) and C4 (restart) at once,
   and today's lane laws could use the same shape. 80 to 150 lines, 1 to 2 agent hours. **85%.**
2. **A version and a chain of named upgrades for saved state** (Minecraft, Unreal, Factorio, Erlang).
   The one place games most challenge a decided note: it undoes "no version number on each machine"
   for any state carried forward, and replaces H3's shape guess. 60 to 100 lines. **70%.**
3. **`seen` on every ledger entry** (lag compensation). The rev the writer had read. It is lost for
   good if Tier 1 writes entries without it, so it is the most time-bound of the five. 20 to 40 lines.
   **75%.**
4. **A step declares what it reads and writes** (Bevy, F.E.A.R.). The key is built from the reads;
   resume is the earliest step whose writes cannot be proved. The ideas of sections 5 and 7, together. 150 to 250 lines.
   **65 to 70%.**
5. **A first-divergence report** (Riot, Factorio). One bundle when two folds that should agree do
   not, naming the first fact where they part. 100 to 200 lines. **75%.**

All five are estimates from reading. None has been tried.

## What this cannot tell us

- **Whether any idea works here.** Nothing was built or run. Every line count is a guess from reading
  our notes, not our code.
- **How much determinism we really have.** The sync test and the divergence report assume `update`
  and the fold are pure. That is the design; I did not check today's machines for a hidden clock or
  random read.
- **The size of the gap.** Games are short sessions owned by one player on one build. Our ledger is
  long-lived, written by many people and agents, and read by builds that change weekly. That makes
  versions more important for us than for games, and replays harder.
- **Agents are not players.** A player's input is cheap to record and replay. An agent's draft is
  expensive, not repeatable, and sometimes private ([an agent run keeps its content](../docs/direction/an-agent-run-keeps-its-content.md)).
  So "replay" for us means re-running code over recorded drafts, never re-rolling a draft.
- **Several sources are second hand.** I could not read Valve's two wiki pages (they refused my reader),
  the Overwatch talk, Naughty Dog's slides, or Unreal's crash reporter docs. What I say of Valve
  comes from search summaries of its pages; I used nothing else from the rest. I found no maker's
  account of how a checkpoint picks its moment, or of how StarCraft keeps old replays playable.
- **What I did not read on our side.** I read the notes the brief named in full or in their decided
  parts, and parts of about eight others. I did not read PR 289's branch, experiments 175 and 186 in
  full, or any of `next/`'s code on PR 223.
- **The study's own agent hours and dollars were not recorded.** No model was called for the study
  itself beyond the session that wrote it.
