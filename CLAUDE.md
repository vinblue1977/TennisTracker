# Working in this repo

## Pull requests

- Before starting new work, run `gh pr list`. If a PR of ours is open (Dependabot PRs merge themselves, see below), get it merged first (fix conflicts or failing checks, `gh pr update-branch <n>`, wait for the merge), then `git pull` main.
- Don't open a second PR while one of ours is open, unless it's docs-only. If two are open, run `gh pr update-branch` on the other as soon as one merges, without waiting to be told.
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

## Dependabot and the Lambda layer

- `layer/requirements.txt` must only hold what `layer/requirements.in` needs (`tests/test_layer_lock.py` checks it). In #112 Dependabot overwrote it with the CDK packages and the deployed API lost `cryptography`.
- Layer packages are ignored in the root pip entry of `.github/dependabot.yml`; the `/layer` entry owns them. Add any new layer package to that ignore list.
- Review every Dependabot PR that touches `layer/`: the diff should be small pin bumps, never a different package set.
