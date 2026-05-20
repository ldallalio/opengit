# OpenGit Product Brief

## Positioning

OpenGit is a personal-first, local-first desktop Git client for developers who want a polished visual workflow without a subscription. It is inspired by the general productivity category of commercial Git GUIs, but it must remain an original product with its own brand, layout, copy, icon language, and interaction model.

## Primary Users

- Solo developers who manage several local repositories and want fast staging, commits, branches, and history.
- Professional developers who need safe branch, stash, pull, push, merge, and rebase flows.
- Developers who prefer a visual commit graph and diff workflow but still trust native Git behavior.

## MVP Scope

The MVP focuses on local Git operations before provider integrations:

- Open and clone repositories.
- Inspect branch state, upstream, ahead/behind, recent history, remotes, stashes, and file status.
- Stage, unstage, discard, commit, and amend.
- Create, checkout, and delete branches with safeguards.
- Fetch, pull, and push through native Git.
- View diffs and recent commits.
- Normalize Git errors into actionable UI messages.

## Deferred Scope

- GitHub PR creation and review.
- GitLab, Bitbucket, and Azure DevOps providers.
- Full conflict resolver.
- Persistent SQLite repository cache.
- Signed auto-updates and crash reporting.
- AI summaries and workflow automation.

## Product Principles

- Local repo contents stay local unless a provider action explicitly sends data.
- Dangerous actions require clear confirmation.
- Use native Git semantics and terminology.
- Keep the UI dense, stable, and keyboard-friendly.
- Favor original design over imitation.
