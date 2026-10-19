These lint rules come from the `biome-plugins/` folder of [kamp-us/phoenix](https://github.com/kamp-us/phoenix), the pipeline this repo rebuilds.
They are copies, unchanged: change a rule there, then copy the file here again.

One rule is this repo's own, not a copy: `no-bare-tell.grit`. A `tell` or `offer` to a program's input is an Effect, and written as a bare statement it is made and dropped, so nothing is told. Change it here.
