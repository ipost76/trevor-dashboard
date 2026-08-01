#!/bin/sh
# selftest.sh — PROVES the lock-guard guarantees under REAL concurrency.
#
# Runs entirely inside a mktemp scratch dir with an isolated LOCK_DIR and a
# throwaway git repo. NEVER touches the live dashboard repo or its history.
# Uses `set -u` (not -e): it is a test runner with explicit assertions, so a
# single failing check must not abort the remaining proofs. Exit 0 iff all pass.
set -u

SDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)   # scripts/locks
DIR="$SDIR"
. "$SDIR/_common.sh"
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT INT TERM

# Hand-built lock directories must use the SAME canonical key the scripts derive.
# 🚨 Do not hardcode an encoded name here: a test that pins the raw-argument
# spelling is exactly the defect case [6] used to assert (see TEST 6).
LK() { lock_key "$1"; }

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
ld="$LOCK_DIR/$(LK stalefile).lock"
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
ld2="$LOCK_DIR/$(LK livefile).lock"
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
echo "TEST 6 — slash-path lock encodes the CANONICAL key"
# 🚨 THIS CASE USED TO ASSERT THE DEFECT. It required app/page.tsx -> the raw
# name 'app__page.tsx.lock', i.e. that the key IS the caller's un-canonicalised
# argument string — the very property that let ONE file hold FOUR locks under
# four spellings. The test passed; the test was the bug. F2 found the identical
# shape in the VM harness (its case [7]): two boxes, two harnesses, each pinning
# its own box's defect in place. Corrected B1 to assert the canonical key.
EXPECT_KEY="$LOCK_DIR/$(LK app/page.tsx).lock"
rc=0
out=$(EXPECT_KEY="$EXPECT_KEY" "$SDIR/with_file_lock.sh" app/page.tsx -- \
        sh -c 'test -d "$EXPECT_KEY" && echo ENCODED-OK || echo MISSING') || rc=$?
after_exists=no; [ -d "$EXPECT_KEY" ] && after_exists=yes
raw_exists=no;   [ -d "$LOCK_DIR/app__page.tsx.lock" ] && raw_exists=yes
echo "  key=$(basename "$EXPECT_KEY")"
echo "  inner check: $out ; exit=$rc ; remains after release=$after_exists ; raw-spelling key created=$raw_exists"
if [ "$out" = "ENCODED-OK" ] && [ "$rc" = 0 ] && [ "$after_exists" = no ] && [ "$raw_exists" = no ]; then
  ok "slash-path locked under the canonical key and released (no raw-spelling key)"
else
  bad "test6 (out=$out rc=$rc after=$after_exists raw=$raw_exists)"
fi
echo

# ---------------------------------------------------------------------------
echo "TEST 7 — L-6 the BYPASS: one file, many spellings, many cwds -> ONE lock"
rm -rf "$LOCK_DIR"/*.lock 2>/dev/null || true
resolve_repo_root   # sets LOCK_REPO_ROOT in THIS shell (LK() only sets it in a subshell)
REPOROOT="$LOCK_REPO_ROOT"
PROMPT_ID=T7-A "$SDIR/lock_acquire.sh" src/app/page.tsx >/dev/null 2>&1; a_rc=$?
b_rc=0; ( cd "$REPOROOT" && LOCK_MAX_WAIT=2 PROMPT_ID=T7-B "$SDIR/lock_acquire.sh" ./src/app/page.tsx ) >/dev/null 2>&1 || b_rc=$?
c_rc=0; ( cd /tmp && LOCK_MAX_WAIT=2 PROMPT_ID=T7-C "$SDIR/lock_acquire.sh" "$REPOROOT/src/app/page.tsx" ) >/dev/null 2>&1 || c_rc=$?
d_rc=0; ( cd / && LOCK_MAX_WAIT=2 PROMPT_ID=T7-D "$SDIR/lock_acquire.sh" src/./app/../app/page.tsx ) >/dev/null 2>&1 || d_rc=$?
nlocks=$(ls -1a "$LOCK_DIR" | grep -c '\.lock$')
echo "  first=$a_rc (0 expected) ; contenders=$b_rc/$c_rc/$d_rc (all 2 = waited) ; distinct locks=$nlocks (1 expected)"
# POSITIVE CONTROL: a genuinely DIFFERENT file must still lock independently.
pc_rc=0; "$SDIR/lock_acquire.sh" src/app/other.tsx >/dev/null 2>&1 || pc_rc=$?
nlocks2=$(ls -1a "$LOCK_DIR" | grep -c '\.lock$')
echo "  positive control: a different file claimed rc=$pc_rc (0 expected), locks now=$nlocks2 (2 expected)"
if [ "$a_rc" = 0 ] && [ "$b_rc" = 2 ] && [ "$c_rc" = 2 ] && [ "$d_rc" = 2 ] \
   && [ "$nlocks" = 1 ] && [ "$pc_rc" = 0 ] && [ "$nlocks2" = 2 ]; then
  ok "one file = one lock across 4 spellings/cwds; distinct files still independent"
else
  bad "test7 (a=$a_rc b=$b_rc c=$c_rc d=$d_rc n=$nlocks pc=$pc_rc n2=$nlocks2)"
fi
rm -rf "$LOCK_DIR"/*.lock 2>/dev/null || true
echo

# ---------------------------------------------------------------------------
echo "TEST 8 — L-1 release: MISMATCH fails loud, absent stays rc=0"
PROMPT_ID=T8-OWNER "$SDIR/lock_acquire.sh" mismatch.ts >/dev/null 2>&1
mm_rc=0; env -u PROMPT_ID "$SDIR/lock_release.sh" mismatch.ts >/dev/null 2>&1 || mm_rc=$?
still=no; [ -d "$LOCK_DIR/$(LK mismatch.ts).lock" ] && still=yes
foreign_rc=0; PROMPT_ID=T8-INTRUDER "$SDIR/lock_release.sh" mismatch.ts >/dev/null 2>&1 || foreign_rc=$?
still2=no; [ -d "$LOCK_DIR/$(LK mismatch.ts).lock" ] && still2=yes
# POSITIVE CONTROLS: the rightful owner releases; absent + double stay rc=0.
own_rc=0; PROMPT_ID=T8-OWNER "$SDIR/lock_release.sh" mismatch.ts >/dev/null 2>&1 || own_rc=$?
gone=no; [ -d "$LOCK_DIR/$(LK mismatch.ts).lock" ] || gone=yes
dbl_rc=0; PROMPT_ID=T8-OWNER "$SDIR/lock_release.sh" mismatch.ts >/dev/null 2>&1 || dbl_rc=$?
abs_rc=0; PROMPT_ID=T8-OWNER "$SDIR/lock_release.sh" never-held.ts >/dev/null 2>&1 || abs_rc=$?
echo "  no-PROMPT_ID rc=$mm_rc (non-zero) lock-still-held=$still ; foreign rc=$foreign_rc still=$still2"
echo "  positive controls: owner rc=$own_rc gone=$gone ; double rc=$dbl_rc ; absent rc=$abs_rc (both 0)"
if [ "$mm_rc" != 0 ] && [ "$still" = yes ] && [ "$foreign_rc" != 0 ] && [ "$still2" = yes ] \
   && [ "$own_rc" = 0 ] && [ "$gone" = yes ] && [ "$dbl_rc" = 0 ] && [ "$abs_rc" = 0 ]; then
  ok "mismatch refused with the lock intact; idempotent absent/double release preserved"
else
  bad "test8 (mm=$mm_rc still=$still fg=$foreign_rc still2=$still2 own=$own_rc gone=$gone dbl=$dbl_rc abs=$abs_rc)"
fi
echo

# ---------------------------------------------------------------------------
echo "TEST 9 — L-2 liveness: durable pid survives; indeterminate is NEVER stolen"
# 9a: the recorded pid must outlive the claiming shell, even from a nested subshell.
( ( ( PROMPT_ID=T9 "$SDIR/lock_acquire.sh" durable.ts >/dev/null 2>&1; true ); true ); true )
read d_o d_e d_p d_s d_h < "$LOCK_DIR/$(LK durable.ts).lock/meta"
p_alive=no; kill -0 "$d_p" 2>/dev/null && p_alive=yes
s_alive=no; kill -0 "$d_s" 2>/dev/null && s_alive=yes
echo "  nested-subshell claim: pid=$d_p alive=$p_alive ; shell_pid=$d_s alive=$s_alive"
"$SDIR/lock_release.sh" durable.ts T9 >/dev/null 2>&1 || true
rm -rf "$LOCK_DIR/$(LK durable.ts).lock" 2>/dev/null || true
# 9b: an OLD lock whose liveness cannot be determined must NOT be reclaimed.
oldep=$(( $(date +%s) - 100000 ))
deadp=999999; while kill -0 "$deadp" 2>/dev/null; do deadp=$((deadp-1)); done
ind_ok=1
for shape in "nopid:GHOST/x $oldep" "badpid:GHOST/x $oldep not-a-pid 1 $(hostname)" "foreign:GHOST/x $oldep $deadp 1 some-other-box"; do
  nm=${shape%%:*}; line=${shape#*:}
  dd="$LOCK_DIR/$(LK "$nm").lock"; mkdir -p "$dd"; printf '%s\n' "$line" > "$dd/meta"
  r=0; LOCK_MAX_WAIT=2 PROMPT_ID=T9-THIEF "$SDIR/lock_acquire.sh" "$nm" >/dev/null 2>&1 || r=$?
  own=$(awk '{print $1}' "$dd/meta" 2>/dev/null)
  [ "$r" = 2 ] && [ "$own" = "GHOST/x" ] || { ind_ok=0; echo "  STOLEN: $nm rc=$r owner=$own"; }
done
# POSITIVE CONTROL: old AND definitively dead on THIS host IS still reclaimable.
dd="$LOCK_DIR/$(LK reclaimable).lock"; mkdir -p "$dd"
printf 'GHOST/x %s %s 1 %s\n' "$oldep" "$deadp" "$(hostname)" > "$dd/meta"
rc_rc=0; LOCK_MAX_WAIT=2 PROMPT_ID=T9-THIEF "$SDIR/lock_acquire.sh" reclaimable >/dev/null 2>&1 || rc_rc=$?
rc_own=$(awk '{print $1}' "$dd/meta" 2>/dev/null)
echo "  indeterminate shapes protected=$ind_ok ; positive control reclaim rc=$rc_rc owner=$rc_own"
if [ "$p_alive" = yes ] && [ "$s_alive" = no ] && [ "$ind_ok" = 1 ] \
   && [ "$rc_rc" = 0 ] && [ "$rc_own" != "GHOST/x" ]; then
  ok "durable pid outlives the claim; unknown liveness never stolen; dead+old still reclaimed"
else
  bad "test9 (palive=$p_alive salive=$s_alive ind=$ind_ok pc_rc=$rc_rc pc_own=$rc_own)"
fi
rm -rf "$LOCK_DIR"/*.lock 2>/dev/null || true
echo

# ---------------------------------------------------------------------------
echo "TEST 10 — L-5 owner namespacing + no unreportable lock"
ts=$(date +%s)
nd="$LOCK_DIR/$(LK ns.ts).lock"; mkdir -p "$nd"
printf 'SAME-LABEL/9999-111 %s 1 1 %s\n' "$ts" "$(hostname)" > "$nd/meta"
ns_rc=0; PROMPT_ID=SAME-LABEL "$SDIR/lock_release.sh" ns.ts >/dev/null 2>&1 || ns_rc=$?
ns_still=no; [ -d "$nd" ] && ns_still=yes
# POSITIVE CONTROL: the SAME label WITH the same namespace does release.
mine=$(lock_owner_id)
printf '%s %s 1 1 %s\n' "$mine" "$ts" "$(hostname)" > "$nd/meta"
ok_rc=0; "$SDIR/lock_release.sh" ns.ts >/dev/null 2>&1 || ok_rc=$?
ok_gone=no; [ -d "$nd" ] || ok_gone=yes
# every held lock must be visible to the ONLY diagnostic that verifies locks
PROMPT_ID=T10 "$SDIR/lock_acquire.sh" visible.ts >/dev/null 2>&1
on_disk=$(ls -1a "$LOCK_DIR" | grep -c '\.lock$')
reported=$("$SDIR/lock_status.sh" | grep -c '\.lock$')
echo "  same label / different ns: rc=$ns_rc still-held=$ns_still (must be non-zero + yes)"
echo "  positive control same ns : rc=$ok_rc gone=$ok_gone"
echo "  locks on disk=$on_disk reported by lock_status=$reported (must match)"
if [ "$ns_rc" != 0 ] && [ "$ns_still" = yes ] && [ "$ok_rc" = 0 ] && [ "$ok_gone" = yes ] \
   && [ "$on_disk" = "$reported" ]; then
  ok "same label in a different session cannot release; every held lock is reportable"
else
  bad "test10 (ns=$ns_rc still=$ns_still ok=$ok_rc gone=$ok_gone disk=$on_disk rep=$reported)"
fi
rm -rf "$LOCK_DIR"/*.lock 2>/dev/null || true
echo

# ---------------------------------------------------------------------------
echo "=================================================="
echo "RESULT: $pass passed, $fail failed"
[ "$fail" = 0 ] || exit 1
echo "ALL GUARANTEES PROVEN."
