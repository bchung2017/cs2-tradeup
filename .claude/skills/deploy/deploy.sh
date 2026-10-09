#!/usr/bin/env bash
# Phased deploy: feature branch -> main. Each phase leaves the repo in a
# consistent state (fully done, or untouched), and main changes in exactly one
# place: a fast-forward push in `publish`, which the remote accepts whole or
# rejects whole. Never force-pushes main.
#
#   deploy.sh preflight   on a feature branch, no merge in progress, tree clean
#   deploy.sh sync        fetch; take remote branch commits; merge origin/main in
#   deploy.sh verify      typecheck + production build
#   deploy.sh publish     push branch, then fast-forward main to HEAD
#   deploy.sh rollback    undo an unpublished deploy merge (or abort a conflicted one)
#   deploy.sh status      where branch, main and HEAD stand
#
# Exit codes: 0 ok · 2 merge conflicts (resolve, commit, re-run verify) ·
# 3 main moved during publish (run sync again) · 10 not on a feature branch ·
# 11 merge in progress · 12 uncommitted changes · 13 branch diverged from its
# remote · 20 verify failed · 30 network failure after retries · 40 refused.
set -uo pipefail

MAIN="${DEPLOY_MAIN:-main}"
REMOTE="${DEPLOY_REMOTE:-origin}"
ROOT="$(git rev-parse --show-toplevel)" || exit 40
cd "$ROOT"
GITDIR="$(git rev-parse --git-dir)"
MARK="$GITDIR/deploy-premerge" # HEAD before the deploy merge, for rollback

say() { printf '[deploy] %s\n' "$*"; }
die() { local code=$1; shift; say "ERROR: $*" >&2; exit "$code"; }

# Network calls retry 4 times with 2/4/8/16 s backoff. A rejection (not a
# network failure) is returned at once so the caller can act on it.
net() {
  local out delay
  for delay in 0 2 4 8 16; do
    [ "$delay" -gt 0 ] && { say "retrying in ${delay}s…"; sleep "$delay"; }
    if out="$("$@" 2>&1)"; then printf '%s\n' "$out"; return 0; fi
    if grep -qiE 'rejected|non-fast-forward|fetch first|stale info|protected branch' <<<"$out"; then
      printf '%s\n' "$out"; return 3
    fi
    printf '%s\n' "$out" | tail -3
  done
  return 30
}

branch() { git rev-parse --abbrev-ref HEAD; }
# The dev server and builds rewrite next-env.d.ts; never let that block a deploy.
restore_generated() { git diff --quiet -- next-env.d.ts 2>/dev/null || git checkout -q -- next-env.d.ts; }

preflight() {
  local b; b="$(branch)"
  [ "$b" = "HEAD" ] && die 10 "detached HEAD; check out the feature branch"
  [ "$b" = "$MAIN" ] && die 10 "on $MAIN; deploy runs from a feature branch"
  [ -f "$GITDIR/MERGE_HEAD" ] && die 11 "a merge is in progress: finish it (commit) or run: deploy.sh rollback"
  restore_generated
  if [ -n "$(git status --porcelain)" ]; then
    git status --short
    die 12 "uncommitted changes; commit them (or stash) before deploying"
  fi
  say "branch $b @ $(git rev-parse --short HEAD), clean"
}

sync() {
  preflight >/dev/null
  local b; b="$(branch)"
  net git fetch "$REMOTE" "$MAIN" >/dev/null || die 30 "fetch $MAIN failed"
  if net git fetch "$REMOTE" "$b" >/dev/null 2>&1; then
    # Commits pushed to this branch elsewhere come in first, so the merge
    # below is built on everything the branch already has.
    if ! git merge-base --is-ancestor "$REMOTE/$b" HEAD; then
      if git merge-base --is-ancestor HEAD "$REMOTE/$b"; then
        git merge -q --ff-only "$REMOTE/$b" && say "fast-forwarded to $REMOTE/$b"
      else
        die 13 "$b and $REMOTE/$b have diverged; merge $REMOTE/$b first, then re-run sync"
      fi
    fi
  fi
  if git merge-base --is-ancestor "$REMOTE/$MAIN" HEAD; then
    rm -f "$MARK"
    say "already contains $REMOTE/$MAIN ($(git rev-parse --short "$REMOTE/$MAIN")); nothing to merge"
    return 0
  fi
  git rev-parse HEAD >"$MARK"
  say "merging $REMOTE/$MAIN ($(git log -1 --format='%h %s' "$REMOTE/$MAIN")) into $b"
  if git merge --no-ff --no-edit "$REMOTE/$MAIN" >/dev/null 2>&1; then
    say "merged cleanly @ $(git rev-parse --short HEAD)"
    return 0
  fi
  say "CONFLICTS — merge left open for resolution:"
  git diff --name-only --diff-filter=U | sed 's/^/  /'
  say "incoming commits from $MAIN:"
  git log --oneline HEAD.."$REMOTE/$MAIN" | head -20 | sed 's/^/  /'
  exit 2
}

verify() {
  [ -f "$GITDIR/MERGE_HEAD" ] && die 11 "merge still open; resolve and commit first"
  rm -rf .next/dev # stale route types from a dev server break tsc
  say "typecheck…"
  npx tsc --noEmit -p . || { restore_generated; die 20 "typecheck failed"; }
  if [ "${DEPLOY_SKIP_BUILD:-0}" != "1" ]; then
    say "production build…"
    npx next build >"$GITDIR/deploy-build.log" 2>&1 || {
      tail -30 "$GITDIR/deploy-build.log"; restore_generated; die 20 "build failed (log: $GITDIR/deploy-build.log)"
    }
  fi
  restore_generated
  say "verify passed @ $(git rev-parse --short HEAD)"
}

publish() {
  preflight >/dev/null
  local b head; b="$(branch)"; head="$(git rev-parse HEAD)"
  net git fetch "$REMOTE" "$MAIN" >/dev/null || die 30 "fetch $MAIN failed"
  git merge-base --is-ancestor "$REMOTE/$MAIN" HEAD || die 3 "$MAIN has commits HEAD lacks; run sync (then verify) again"
  net git push -u "$REMOTE" "$b" >/dev/null; case $? in 0) ;; 3) die 40 "push of $b rejected" ;; *) die 30 "push of $b failed" ;; esac
  say "pushed $b"
  # The one step that changes main: a plain (non-force) push, which the remote
  # applies only as a fast-forward. If main moved since the fetch above, it is
  # rejected whole and main is untouched.
  net git push "$REMOTE" "HEAD:$MAIN"; case $? in
    0) ;;
    3) die 3 "$MAIN moved while publishing; run sync, verify, publish again" ;;
    *) die 30 "push to $MAIN failed" ;;
  esac
  net git fetch "$REMOTE" "$MAIN" >/dev/null || true
  [ "$(git rev-parse "$REMOTE/$MAIN")" = "$head" ] || die 40 "$REMOTE/$MAIN is not HEAD after push; check it"
  rm -f "$MARK"
  say "DEPLOYED: $MAIN = $b = $(git rev-parse --short HEAD)"
}

rollback() {
  if [ -f "$GITDIR/MERGE_HEAD" ]; then
    git merge --abort && rm -f "$MARK" && say "aborted the open merge; HEAD back at $(git rev-parse --short HEAD)"
    return 0
  fi
  [ -f "$MARK" ] || die 40 "no unpublished deploy merge to roll back"
  if [ -n "$(git branch -r --contains HEAD 2>/dev/null)" ]; then
    die 40 "HEAD is already on the remote; it can't be rolled back locally"
  fi
  local to; to="$(cat "$MARK")"
  git reset -q --hard "$to" && rm -f "$MARK" && say "rolled back to $(git rev-parse --short HEAD)"
}

status() {
  local b; b="$(branch)"
  net git fetch "$REMOTE" "$MAIN" >/dev/null 2>&1 || true
  say "branch $b @ $(git rev-parse --short HEAD)"
  say "$REMOTE/$MAIN @ $(git rev-parse --short "$REMOTE/$MAIN")"
  say "main has $(git rev-list --count HEAD.."$REMOTE/$MAIN") commit(s) HEAD lacks; HEAD has $(git rev-list --count "$REMOTE/$MAIN"..HEAD) not on main"
  [ -f "$GITDIR/MERGE_HEAD" ] && say "a merge is in progress"
  [ -f "$MARK" ] && say "an unpublished deploy merge is pending (rollback target $(cut -c1-7 "$MARK"))"
  return 0
}

case "${1:-}" in
  preflight|sync|verify|publish|rollback|status) "$1" ;;
  *) sed -n '2,20p' "$0"; exit 40 ;;
esac
