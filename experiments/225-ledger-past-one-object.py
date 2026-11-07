# Experiment 225: bytes per ledger entry on disk, on P6's tables
# (next/packages/libfabrika/src/data/referee.ts, TABLES; the rings table is left out).
# Python's own sqlite3, 100,000 rows per shape, seed 119120. No network, no model, $0.
#
#   nice -n 19 python3 -I experiments/225-ledger-past-one-object.py "$(mktemp -d)"
#
# The one argument is a folder for the throwaway database files; each is deleted after it is measured.
import json, os, random, sqlite3, sys

TABLES = ["""CREATE TABLE IF NOT EXISTS entries (
 rev INTEGER PRIMARY KEY, stream TEXT NOT NULL, pos INTEGER NOT NULL, id TEXT NOT NULL,
 "arrivedAt" INTEGER NOT NULL, "by" TEXT NOT NULL, "for" TEXT NOT NULL, "sentAt" TEXT NOT NULL,
 seen INTEGER NOT NULL, cause TEXT, build TEXT NOT NULL, "_tag" TEXT NOT NULL, body TEXT NOT NULL,
 UNIQUE (stream, pos), UNIQUE (stream, id))""",
 "CREATE INDEX IF NOT EXISTS entries_by_stream ON entries (stream, rev)"]
random.seed(119120)

def run(name, bodysize, n=100_000, streams=400):
    p = os.path.join(sys.argv[1], f"m-{name}.db")
    if os.path.exists(p): os.remove(p)
    db = sqlite3.connect(p)
    for t in TABLES: db.execute(t)
    pos = {}
    rows = []
    for rev in range(1, n + 1):
        s = f"ticket:{random.randint(1, streams)}/inbox"
        pos[s] = pos.get(s, 0) + 1
        b = bodysize() if callable(bodysize) else bodysize
        body = json.dumps({"type": "comment", "text": "x" * max(0, b - 30)})
        rows.append((rev, s, pos[s], f"in-{random.getrandbits(32):08x}-{rev}", 1793936907809 + rev,
            "key:gateway:t1:ab12cd34", "user:github:1783869", "2026-11-07T13:55:01.123Z", rev - 1,
            f"in-{random.getrandbits(32):08x}-{rev}", "a1b2c3d4e5f6", "send", body))
    db.executemany("INSERT INTO entries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    db.commit()
    size = db.execute("select page_count*page_size from pragma_page_count, pragma_page_size").fetchone()[0]
    payload = sum(sum(len(str(x)) for x in r) for r in rows)
    print(name, "bytes/row on disk", round(size / n), "payload/row", round(payload / n))
    db.close(); os.remove(p)

run("small60", 60)
run("fact300", 300)
run("comment700", 700)
run("blend", lambda: random.choices([60, 300, 700], [70, 20, 10])[0])
