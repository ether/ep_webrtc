# Contributing to ep_webrtc

Thanks for helping improve `ep_webrtc` — a plugin for [Etherpad](https://etherpad.org/). LLM/Agent contributions are explicitly welcome, provided they follow the rules below.

For shared rules that apply to all Etherpad code (linear commits, deprecation policy, feature flags, stability guarantees), please read [ether/etherpad's CONTRIBUTING.md](https://github.com/ether/etherpad/blob/develop/CONTRIBUTING.md). This document only covers what's specific to plugin work.

## Plugin-specific rules

* **Target branch:** PRs go to `main` on this repo. Plugin repos do not use git-flow's `develop` branch.
* **Linear commits, no merge commits.** Rebase if needed.
* **Every bug fix must include a regression test in the same commit.**
* **Internationalization (i18n):** every user-facing string lives in `locales/<lang>.json` and is referenced via `data-l10n-id` in templates or `html10n.get(key)` in code. No hardcoded English in markup.
* **Accessibility (a11y):** no nested interactive elements (no `<button>` inside `<a>`); every interactive control has an accessible name; keyboard focus order matches visual order. Note that on icon-only controls you should rely on Etherpad's html10n to populate `aria-label` from the `data-l10n-id` translation — adding a hardcoded English `aria-label` blocks that and leaves the control untranslated.

## Local development

`ep_webrtc` is a plugin, so you develop it inside a checkout of [ether/etherpad](https://github.com/ether/etherpad).

```bash
# Once: clone etherpad alongside this repo
git clone https://github.com/ether/etherpad.git
cd etherpad
pnpm install

# Install ep_webrtc from your local clone
pnpm run plugins i --path ../ep_webrtc

# Start the dev server (port 9001)
pnpm --filter ep_etherpad-lite run dev
```

Edits in `../ep_webrtc/` are picked up after a server restart.

## Tests

Tests live inside this repo and are executed by Etherpad's test harness:

* Backend (Mocha): `static/tests/backend/specs/`
* Playwright (frontend E2E): `static/tests/frontend-new/specs/`

Run them from the etherpad checkout:

```bash
# Backend (no separate server needed, harness boots one)
pnpm --filter ep_etherpad-lite run test

# Playwright (requires `pnpm run dev` in another terminal)
pnpm --filter ep_etherpad-lite run test-ui
```

Lint locally before pushing:

```bash
pnpm run lint
```

## Coding style

* JS/CSS/HTML: 2 spaces, no tabs.
* `pnpm run lint` must pass (configured via `eslint-config-etherpad`).
* Avoid breaking changes to public hooks, the line-attribute storage shape, or HTML export output. The backend export spec enforces a stable shape.

## Bug reports

Please include:

* Etherpad version, ep_webrtc version, browser + OS
* Steps to reproduce
* What you expected, what actually happened
* Server log excerpt (set `"loglevel": "DEBUG"` in `settings.json` for verbose output)

## AI agents

If you are an LLM/agent contributor, also read [`AGENTS.md`](AGENTS.md) — it documents the file layout, helper usage, and standing rules for autonomous edits.
