---
name: GitHub Publishing
description: Conventions for committing SOLAR deliverables to a GitHub repository with publish_artifacts_to_github (folder layout, which files, commit message).
---

# GitHub Publishing

Only publish when the user asks for it (e.g. "simpan ke GitHub", "push ke repo").

## Folder layout
`docs/architecture/<system-slug>/` - one folder per system; files keep their artifact names so the
Markdown TSD links to its sibling SVG diagrams correctly.

## What to publish
Publish the whole package of the task so links resolve:
- `*.archimate.xml` (import into Archi / Visual Paradigm), view `*.svg`
- `*.sequence.svg`, `*.mmd` (Mermaid - renders on GitHub), `*.puml`
- TSD `*.md` (renders on GitHub) and `*.html` (print-ready)
- `*.json` sources are optional (useful for regenerating with SOLAR).

## Branch and commit
- Branch: the configured default unless the user names one (a new branch is created from the default).
- Commit message (Conventional Commits):
  `docs(architecture): <system> - ArchiMate, sequence diagrams and TSD v<version>`

## After publishing
Give the user the commit URL and the folder URL returned by the tool.
