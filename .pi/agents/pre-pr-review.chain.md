---
name: pre-pr-review
description: Run security review before creating a PR. Chain: security-reviewer audits the code, then github-pr generates the PR description. Use at the end of a feature branch before merging.
---

## security-reviewer

Run a focused security review on recent changes. Check `git diff main..HEAD --stat` to see what changed, then audit those files specifically. Focus on new attack surface, not the full codebase.

## github-pr

Generate a PR description for the current branch. Include any security findings from the previous step in a 'Security Review' section of the PR body. Previous step output:

{previous}
