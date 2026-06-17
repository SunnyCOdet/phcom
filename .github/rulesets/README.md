# Repository rulesets

## protect-main.json

A branch ruleset for `main`. It is **solo-friendly**:

- 🚫 Blocks force-pushes (`non_fast_forward`)
- 🚫 Blocks branch deletion (`deletion`)
- ✅ Requires changes to go through a pull request, but **0 required approvals**
  — so you can open and merge your own PRs without a second reviewer.

GitHub rulesets can't be created from a plain file in the repo automatically;
import this JSON once via the web UI:

1. GitHub → your repo → **Settings** → **Rules** → **Rulesets**
2. **New ruleset** → **Import a ruleset**
3. Select `.github/rulesets/protect-main.json`
4. Confirm **Enforcement status: Active** → **Create**

To tighten later, add a `required_status_checks` rule (e.g. require the
**Build** workflow to pass) and bump `required_approving_review_count`.

> Note: once active, direct pushes to `main` are blocked — use a branch + PR.
