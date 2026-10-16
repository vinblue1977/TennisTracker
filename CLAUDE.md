# Working in this repo

## Pull requests

- `git pull` main before branching. Use a conventional title (`feat:`, `fix:`, `ci:`, `docs:`).
- Run `make check` before pushing.
- After `gh pr create`, run `gh pr merge --auto --squash` yourself. There is no bot auto-merge: merges made with
  `GITHUB_TOKEN` don't start the push run, so the deploy would be skipped.
- When an earlier PR merges, run `gh pr update-branch <n>` on the PRs still open (branch protection needs them up to date).
- If a PR ever merges without a push run on main, deploy with `gh workflow run ci.yml --ref main`.
