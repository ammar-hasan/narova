---
name: request-codex-review
description: Request an independent, non-interactive Codex code review, verify its findings, and optionally repeat the review after fixes. Use when a user asks to run or call Codex for review, get a Codex second opinion, audit an implementation against a problem statement or acceptance checklist, review uncommitted changes or a branch/commit, or use Codex as a final implementation gate.
---

# Request Codex Review

Use Codex as an independent reviewer. Give it the implementation contract, collect findings, and verify every finding before presenting or acting on it.

## Prepare the review

1. Work from the repository root.
2. Inspect `git status --short` and the relevant diff without changing files.
3. Derive a compact review contract from the user's request:
   - problem statement or intended behavior
   - concrete acceptance criteria
   - review scope
   - key files or subsystems
   - relevant tests and likely regression surfaces
4. Keep unrelated user changes in view, but tell the reviewer not to report pre-existing or out-of-scope issues.

Do not ask Codex to reimplement the feature. Ask it for findings backed by file and line references.

## Choose the invocation

Use a custom prompt when the review must evaluate a specific problem statement or checklist:

```sh
codex review "$review_prompt" 2>&1 | tee "$review_log"
```

Set `review_log` to a temporary file created with `mktemp`. Put the desired target in the prompt, such as "review the current uncommitted changes" or "review the changes relative to main."

Use a target flag when exact Git scope matters more than a custom rubric:

```sh
codex review --uncommitted
codex review --base main
codex review --commit <sha>
```

`codex review` does not accept `--base` together with a positional prompt. Do not retry that invalid combination; choose one of the modes above.

## Write the prompt

Use this shape and replace every placeholder:

```text
Review the implementation against this contract.

Problem statement:
<what the change must accomplish>

Scope:
<uncommitted changes, diff relative to a branch, or a commit>

Acceptance criteria:
1. <criterion>
2. <criterion>

Key files:
- <path>

Check correctness, regressions, edge cases, validation, and test coverage. Report only actionable findings, ordered by severity. For each finding include a file and line reference, the evidence, the impact, and a concrete fix direction. Do not report unrelated pre-existing issues. If there are no findings, say so explicitly and mention any residual testing risk.
```

Include only useful context. Prefer exact requirements and paths over a long narrative.

## Verify and act

1. Read the complete review output.
2. Verify each claimed issue against the code, diff, and tests. Treat reviewer output as evidence to investigate, not ground truth.
3. Discard false positives, duplicates, style-only preferences, and out-of-scope findings. Explain any materially plausible finding that was rejected.
4. If the user asked only for a review, report the verified findings without editing.
5. If the user asked to implement or finish the change, fix verified findings, run focused tests, then request one fresh Codex review. Repeat only while new actionable findings remain.
6. Stop if the same disputed finding repeats without new evidence; report the disagreement instead of looping.

Do not let the reviewer mutate the worktree. Do not delegate product decisions that require the user. Preserve unrelated changes.

## Report

Lead with the outcome: verified findings and their severity, or a clear no-findings result. State the reviewed scope, tests run, fixes made if authorized, and residual risks. Do not present raw Codex output as independently confirmed.
