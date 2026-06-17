#!/bin/sh
# selftest.sh — PROVES the lock-guard guarantees under REAL concurrency.
#
# Runs entirely inside a mktemp scratch dir with an isolated LOCK_DIR and a
# throwaway git repo. NEVER touches the live dashboard repo or its history.
# Uses `set -u` (not -e): it is a test runner with explicit assertions, so a
# single failing check must not abort the remaining proofs. Exit 0 iff all pass.
set -u

SDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)   # scripts/locks
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

export LOCK_DIR="$SCRATCH/.locks"
export LOCK_MAX_WAIT=20      # generous: test 1 serializes 10 contenders under contention
export LOCK_RETRY=0.2        # fine poll so a 0.3s hold isn't retry-gated into a timeout
mkdir -p "$LOCK_DIR"

pass=0; fail=0
ok()  { pass=$((pass+1)); echo "  PASS: $1"; }
bad() { fail=$((fail+1)); echo "  FAIL: $1"; }

echo "== scratch : $SCRATCH"
echo "== LOCK_DIR: $LOCK_DIR"
echo

# ---------------------------------------------------------------------------
echo "TEST 1 — same-file mutual exclusion (10 concurrent on ONE flag)"
CNT="$SCRATCH/cnt"; MAX="$SCRATCH/max"; VIOL="$SCRATCH/viol"; ORDER="$SCRATCH/order"; CS="$SCRATCH/cs"
printf '0' > "$CNT"; : > "$MAX"; : > "$VIOL"; : > "$ORDER"
cat > "$SCRATCH/worker1.sh" <<'EOF'
#!/bin/sh
id=$1; CNT=$2; MAX=$3; VIOL=$4; ORDER=$5; CS=$6
cur=$(cat "$CNT"); cur=$((cur+1)); printf '%s' "$cur" > "$CNT"; echo "$cur" >> "$MAX"
mkdir "$CS" 2>/dev/null || echo OVERLAP >> "$VIOL"   # detect any concurrent entry
echo "w-$id" >> "$ORDER"
sleep 0.3
rmdir "$CS" 2>/dev/null || true
cur=$(cat "$CNT"); cur=$((cur-1)); printf '%s' "$cur" > "$CNT"
EOF
chmod +x "$SCRATCH/worker1.sh"
i=1
while [ "$i" -le 10 ]; do
  "$SDIR/with_file_lock.sh" sameflag -- "$SCRATCH/worker1.sh" "$i" "$CNT" "$MAX" "$VIOL" "$ORDER" "$CS" &
  i=$((i+1))
done
wait
maxc=$(sort -n "$MAX" | tail -1)
writes=$(wc -l < "$ORDER" | tr -d ' ')
viol=$(wc -l < "$VIOL" | tr -d ' ')   # each OVERLAP is one line; empty file -> 0
echo "  observed max concurrency=$maxc ; writes=$writes ; overlaps=$viol"
if [ "$maxc" = 1 ] && [ "$writes" = 10 ] && [ "$viol" = 0 ]; then
  ok "counter never >1, all 10 writes present, zero overlap"
else
  bad "test1 (maxc=$maxc writes=$writes viol=$viol)"
fi
echo

# ---------------------------------------------------------------------------
echo "TEST 2 — different-file parallelism (6 distinct locks run concurrently)"
cat > "$SCRATCH/worker2.sh" <<'EOF'
#!/bin/sh
sleep 0.6
EOF
chmod +x "$SCRATCH/worker2.sh"
t0=$(date +%s%N)
i=1
while [ "$i" -le 6 ]; do
  "$SDIR/with_file_lock.sh" "file$i.txt" -- "$SCRATCH/worker2.sh" &
  i=$((i+1))
done
wait
t1=$(date +%s%N)
elapsed_ms=$(( (t1 - t0) / 1000000 ))
echo "  6 x 0.6s sleeps on distinct locks took ${elapsed_ms}ms (serial would be ~3600ms)"
if [ "$elapsed_ms" -lt 1500 ]; then
  ok "ran concurrently (${elapsed_ms}ms < 1500ms)"
else
  bad "test2 — looks serialized (${elapsed_ms}ms)"
fi
echo

# ---------------------------------------------------------------------------
echo "TEST 3 — stale reclaim (old+dead reclaimed; fresh+live NOT stolen)"
# 3a: old + dead -> reclaim
deadpid=999999
while kill -0 "$deadpid" 2>/dev/null; do deadpid=$((deadpid-1)); done
oldepoch=$(( $(date +%s) - 100000 ))
ld="$LOCK_DIR/stalefile.lock"
mkdir -p "$ld"; printf 'ghostowner %s %s\n' "$oldepoch" "$deadpid" > "$ld/meta"
if "$SDIR/lock_acquire.sh" stalefile newowner 900; then
  read no ne np < "$ld/meta"
  if [ "$no" = "newowner" ]; then ok "3a old+dead lock reclaimed (owner now '$no')"; else bad "3a meta not updated (owner=$no)"; fi
  "$SDIR/lock_release.sh" stalefile newowner
else
  bad "3a failed to reclaim an old+dead lock"
fi
# 3b: fresh + live -> must NOT steal (acquire times out, meta intact)
sleep 600 & livepid=$!
ld2="$LOCK_DIR/livefile.lock"
mkdir -p "$ld2"; printf 'liveowner %s %s\n' "$(date +%s)" "$livepid" > "$ld2/meta"
rc=0
LOCK_MAX_WAIT=3 "$SDIR/lock_acquire.sh" livefile newowner 900 || rc=$?
read lo le lp < "$ld2/meta"
if [ "$rc" = 2 ] && [ "$lo" = "liveowner" ]; then
  ok "3b fresh+live lock NOT stolen (acquire timed out, meta intact)"
else
  bad "3b stole a fresh live lock (rc=$rc owner=$lo)"
fi
kill "$livepid" 2>/dev/null || true
rm -rf "$ld2"
echo

# ---------------------------------------------------------------------------
echo "TEST 4 — commit serialization (5 concurrent committers -> linear history)"
REPO="$SCRATCH/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q
git -C "$REPO" config user.email test@local
git -C "$REPO" config user.name tester
git -C "$REPO" commit -q --allow-empty -m "root"
cat > "$SCRATCH/worker4.sh" <<EOF
#!/bin/sh
n=\$1
echo "\$n" > "$REPO/file\$n.txt"
"$SDIR/git_commit_serialized.sh" -- "git -C '$REPO' add file\$n.txt && git -C '$REPO' commit -q -m 'commit-\$n'"
EOF
chmod +x "$SCRATCH/worker4.sh"
i=1
while [ "$i" -le 5 ]; do "$SCRATCH/worker4.sh" "$i" & i=$((i+1)); done
wait
commits=$(git -C "$REPO" rev-list --count HEAD)
if git -C "$REPO" fsck --full >/dev/null 2>&1; then fsck=clean; else fsck=DIRTY; fi
idxlock=no; [ -e "$REPO/.git/index.lock" ] && idxlock=yes
echo "  commits on HEAD (incl root) = $commits (expect 6) ; fsck=$fsck ; leftover index.lock=$idxlock"
if [ "$commits" = 6 ] && [ "$fsck" = clean ] && [ "$idxlock" = no ]; then
  ok "5 commits landed, linear, fsck clean, no index.lock residue"
else
  bad "test4 (commits=$commits fsck=$fsck idxlock=$idxlock)"
fi
echo

# ---------------------------------------------------------------------------
echo "TEST 5 — 'git add .' refused (fail loud, zero mutation)"
before=$(git -C "$REPO" rev-list --count HEAD)
echo "newfile" > "$REPO/sneaky.txt"
rc=0
"$SDIR/git_commit_serialized.sh" -- "git -C '$REPO' add . && git -C '$REPO' commit -q -m sneaky" || rc=$?
after=$(git -C "$REPO" rev-list --count HEAD)
staged=$(git -C "$REPO" diff --cached --name-only | wc -l | tr -d ' ')
echo "  exit=$rc (expect 3) ; commits before=$before after=$after ; staged=$staged"
if [ "$rc" = 3 ] && [ "$before" = "$after" ] && [ "$staged" = 0 ]; then
  ok "git add . refused, nothing staged or committed"
else
  bad "test5 (rc=$rc before=$before after=$after staged=$staged)"
fi
echo

# ---------------------------------------------------------------------------
echo "TEST 5b — refuse-pattern coverage (each bare-add form must exit 3)"
allgood=1
for c in "git add ." "git add -A" "git add --all" "git -C /tmp add ." "echo hi && git add . && echo bye"; do
  rc=0
  "$SDIR/git_commit_serialized.sh" -- "$c" >/dev/null 2>&1 || rc=$?
  if [ "$rc" = 3 ]; then echo "  refused (3): $c"; else echo "  NOT refused (rc=$rc): $c"; allgood=0; fi
done
# a specific-file add must NOT be refused (rc != 3)
rc=0
( cd "$SCRATCH" && "$SDIR/git_commit_serialized.sh" -- "git add specific_file.txt" ) >/dev/null 2>&1 || rc=$?
if [ "$rc" = 3 ]; then echo "  WRONG: refused a specific-file add"; allgood=0; else echo "  allowed (rc=$rc, not 3): git add specific_file.txt"; fi
if [ "$allgood" = 1 ]; then ok "all bare-add forms refused; specific-file add allowed"; else bad "test5b"; fi
echo

# ---------------------------------------------------------------------------
echo "TEST 6 — slash-path lock (app/page.tsx -> encoded name)"
rc=0
out=$("$SDIR/with_file_lock.sh" app/page.tsx -- sh -c 'test -d "$LOCK_DIR/app__page.tsx.lock" && echo ENCODED-OK || echo MISSING') || rc=$?
after_exists=no; [ -d "$LOCK_DIR/app__page.tsx.lock" ] && after_exists=yes
echo "  inner check: $out ; exit=$rc ; lock remains after release=$after_exists"
if [ "$out" = "ENCODED-OK" ] && [ "$rc" = 0 ] && [ "$after_exists" = no ]; then
  ok "slash-path locked as app__page.tsx.lock and released"
else
  bad "test6 (out=$out rc=$rc after=$after_exists)"
fi
echo

# ---------------------------------------------------------------------------
echo "=================================================="
echo "RESULT: $pass passed, $fail failed"
[ "$fail" = 0 ] || exit 1
echo "ALL GUARANTEES PROVEN."
