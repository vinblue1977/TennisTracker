# Working in this repo

## Pull requests

- Before starting new work, run `gh pr list`. If a PR is open, get it merged first (fix conflicts or failing checks, `gh pr update-branch <n>`, wait for the merge), then `git pull` main.
- Don't open a second PR while one is open, unless it's docs-only. If two are open, run `gh pr update-branch` on the other as soon as one merges, without waiting to be told.
- `git pull` main before branching. Use a conventional title (`feat:`, `fix:`, `ci:`, `docs:`).
- Run `make check` before pushing.
- After `gh pr create`, run `gh pr merge --auto --squash` yourself. Merges made with `GITHUB_TOKEN` don't start the
  push run, so the deploy would be skipped.
- Dependabot PRs merge themselves (`dependabot-automerge.yml`, using the `AUTOMERGE_TOKEN` PAT) and the workflow
  comments `@dependabot rebase` on the ones still open. Never `gh pr update-branch` a Dependabot PR: Dependabot then
  refuses to rebase it (fix: comment `@dependabot recreate`). If the token expires, merges stop; renew the secret.
- When an earlier PR merges, run `gh pr update-branch <n>` on your own PRs still open (branch protection needs them up to date).
- After a PR merges, delete its branches: `git fetch --prune`, then `git branch -D` every local branch marked `gone` (and any remote branch of a merged PR that GitHub left behind). Never delete a branch with an open PR.
- If a PR ever merges without a push run on main, deploy with `gh workflow run ci.yml --ref main`.
