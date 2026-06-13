# Contributing to Jarvis OS

Thanks for your interest in contributing. Jarvis OS is an autonomous personal-assistant OS. We welcome bug reports, fixes, docs, and ideas, but please read this guide first so your work has the best chance of landing.

## Where To Start

If you noticed a bug or have a feature request, check the [issues](https://github.com/battlesbudz/jarvis-os/issues) first to see whether someone already opened a ticket.

For non-trivial changes, open an issue first describing:

- The problem
- The proposed approach
- The risk

## Before You Write Code

1. Read [`AGENTS.md`](./AGENTS.md). It defines the workflow, safety boundaries, and approval rules every change must respect.
2. Skim [`docs/architecture.md`](./docs/architecture.md) and [`docs/workspace-map.md`](./docs/workspace-map.md). They explain the routing, auth, and persistence layers.
3. Search existing issues and PRs to make sure the work is not already in flight.

## Local Development

### Prerequisites

- Node.js 22.x and npm 10.x
- PostgreSQL 16+
- Python 3.11+
- On macOS, Xcode command-line tools
- On Linux, the dependencies listed in `replit.nix`

### First Run

```bash
git clone https://github.com/battlesbudz/jarvis-os.git
cd jarvis-os
npm install
cp .env.example .env
npm run db:push
npm run server:dev
npm run expo:dev
cd dashboard && npm run dev
```

## Branches

Fork the repo and create a branch with a descriptive name:

```bash
git checkout -b 325-add-slack-integration
```

Keep your branch focused and small enough to review.

## Pull Requests

Before opening a PR:

```bash
git remote add upstream https://github.com/battlesbudz/jarvis-os.git
git checkout main
git pull upstream main
git checkout 325-add-slack-integration
git rebase main
git push --set-upstream origin 325-add-slack-integration
```

Then open a pull request on GitHub.
