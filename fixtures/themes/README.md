# Theme laws for today's app

Ticket 343, PR 1. `laws.ts` contains generated inputs and independent color math.
All generated checks use seed 119120. The original five schemes under `source/`
are byte-for-byte copies from experiment 177. The two license files there belong
with them. They are public theme inputs, never settings from a machine.

`settings.toml` is the corrected combined settings example.
`settings-conflict.toml` keeps the old, invalid key/table spelling for refusal.

The six mapped inputs use all 21 global names. `laws.ts` owns decision 0009's
independent gray derivation; experiment 239 uses it for every kept input.
`mapped-hashes.json` pins the resulting bytes. The source files are unchanged.

Experiment 239 measured repair version `1` at cap `0.1705827986227786`.
Solarized Light's `text-faint` on `surface-selected/surface-raised` sets it.
`calibration.json` holds all five uncapped and capped reports, the invented
result, sorted moves, substitutions, remaining failures and drawn colors.
`tokens/repair.toml` pins the same version, cap and pair. The readings' last
bits differ between Node releases, so T13 accepts 4 epsilons on doubles alone
(verification.md). Visual review remains pending.

`pnpm exec node experiments/239-theme-repair.ts --radix` measures every gray,
accent and look from the current token inputs. It keeps full values and readings
under `runs/`; `verification.md` lists every remaining failure. Scale text chooses
the faintest passing step. Accent labels choose white, then black, against both
fixed fills. A pick with no passing label remains a failure under T7.
