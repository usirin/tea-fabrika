# Code review: the default rubric

fabrika ships this rubric. A repository uses its own instead by naming a
folder in `.fabrika/fabrika.toml` (`[review] rubrics`), or a machine by naming one in
`tsh.toml` (`rubrics`).

## Per criterion

- Find the lines that meet each criterion. A criterion with no line to point
  at is not met.
- A criterion about behaviour needs a test that would fail without the
  change. Name the test.

## Standing checks

- **tests-prove-it**: each new behaviour has a test, and the test would fail
  if the change were taken out.
- **no-silent-catch**: an error that is caught is handed on or reported, never
  dropped.
- **no-guess-on-unknown**: a value that could not be read is not taken as a
  pass, a zero or an empty list.
- **smallest-change**: nothing changed that the ticket does not need: no
  renames, moves or reformatting beside the change.
- **no-secret**: no key, token, password or personal path is added.
