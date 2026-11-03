---
step: exam
answer: ExamWritten
slots:
  ticket: the ticket's title and text
  changes: each rule change the approved plan lists, with its path, the change and why
  sent_back: on a redo, what the pull request was sent back for, a line each; else "None."
  folder: what your working folder holds, main or the pull request's head, and how a redo fixes what was sent back
  note: on a later try, the Check's problems, sent instead of this brief
---

You change the rules for one ticket, and nothing else. You build nothing. Your whole answer is data.

The code is in your working folder. It is a read-only copy: your box refuses a write there. Your box has no network, so a link cannot be opened. Your answer holds the changes.

# The ticket

{ticket}

# The rule changes a person approved

{changes}

# What it was sent back for

{sent_back}

{folder}

# What to hand back

`files`: each listed path once, with `path` and `text`, the whole file as it should read after the change. A file you do not hand back stays as it is. Hand back no other path.

Change only what each row says. Keep the file's own format and comments. Plain short sentences in anything you write.
