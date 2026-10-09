---
name: deploy
description: Merge the current feature branch into main and push it, in fixed phases — preflight, sync (merge main in), verify (typecheck + build), publish (fast-forward main). Handles merge conflicts by resolving them on the feature branch, never on main. Run only when the user types /deploy.
disable-model-invocation: true
argument-hint: "[--skip-build]"
---

# /deploy

Ship the current feature branch to `main`. Everything mechanical is in
`.claude/skills/deploy/deploy.sh`; this file covers the order, the judgement
calls (conflicts, failures) and what to report.

## Guarantees

- **Main changes in one step only.** The last phase does a plain push of
  `HEAD:main`, which the remote accepts only as a fast-forward. It lands whole
  or is rejected whole. Never force-push main. Never commit on main directly.
- **Conflicts are resolved on the feature branch,** in a merge commit there,
  before anything touches main.
- **Each phase leaves the repo consistent:** finished, or untouched. Nothing is
  pushed until the merged result typechecks and builds.
- **Retries go back to the start of sync,** never part-way through.

## Phases

Run from the repo root. Stop at the first nonzero exit and handle it as shown
in the table below.

```
bash .claude/skills/deploy/deploy.sh preflight
bash .claude/skills/deploy/deploy.sh sync
bash .claude/skills/deploy/deploy.sh verify      # DEPLOY_SKIP_BUILD=1 with --skip-build
bash .claude/skills/deploy/deploy.sh publish
```

1. **preflight**: on a feature branch, no merge open, tree clean. If it exits
   12 (uncommitted changes), look at them. Commit them with a clear message if
   they are part of the work being deployed; ask the user if they look
   unrelated or accidental. Never commit secrets, `.env*` or session logs.
2. **sync**: fetches, takes any commits already on the remote branch, then
   merges `origin/main` into the branch with `--no-ff`. Exit 0 means merged or
   already up to date.
3. **verify**: typecheck, then `next build`. Exit 20 means the merged result is
   broken: fix it with a commit on the branch and run verify again. If the
   failure comes from main's side and isn't a small, obvious fix, run
   `rollback` and report instead.
4. **publish**: pushes the branch, then fast-forwards main. Ends with
   `DEPLOYED: main = <branch> = <sha>` once it has confirmed `origin/main`
   equals HEAD.

## Exit codes

| Code | Meaning | Do this |
|---|---|---|
| 2 | Merge conflicts, merge left open | Resolve (below), `git add`, `git commit --no-edit`, then **verify** |
| 3 | Main moved (another session pushed) | Back to **sync** → verify → publish. Give up after 3 rounds and report |
| 10 | On main or detached | Stop and ask which branch to deploy |
| 11 | Merge already open | Finish it, or `rollback` to abort it |
| 12 | Uncommitted changes | See preflight above |
| 13 | Branch diverged from its remote copy | `git merge origin/<branch>`, resolve as with code 2, re-run sync |
| 20 | Typecheck or build failed | See verify above |
| 30 | Network failed after 4 retries | Report. Nothing half-done: re-running the same phase is safe |
| 40 | Refused (safety check) | Read the message, report, don't work around it |

## Resolving conflicts (exit 2)

Read both sides before editing. `git diff` shows the conflict hunks, and
`git log --oneline HEAD..origin/main` shows what main brought in and why.

- **Both sides added things** (imports, list entries, CSS rules, config keys,
  new functions): keep both. This is most conflicts.
- **Main renamed, moved or restructured something the branch also touched:**
  take main's structure and re-apply the branch's change on top of it. Check
  for references to old paths or routes elsewhere, e.g. `grep` for a moved
  route.
- **Both sides changed the same logic differently,** and keeping one loses
  behaviour the other needs: stop. Run `rollback`, then use AskUserQuestion to
  ask the user which behaviour to keep, showing both versions.
- **Generated or data files** (`public/data/*.json`, lockfiles): take main's
  version, then regenerate if the branch's change depends on it. Never
  hand-merge JSON data.

Afterwards confirm no markers remain (`git grep -n '^<<<<<<<\|^>>>>>>>'`),
then commit the merge and run **verify**.

## Rollback

`deploy.sh rollback` aborts an open merge, or resets an unpublished deploy
merge back to the commit before it. It refuses once HEAD has been pushed.

## Report

Keep it short: what shipped (commits, from `git log --oneline` of the deploy),
the main SHA, any conflicts and how each was resolved, and anything skipped or
left for the user. If it stopped early, say at which phase, why, and what state
the repo is in. A failed deploy always leaves main untouched.
