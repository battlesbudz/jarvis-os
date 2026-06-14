# Changelog

All notable changes to Jarvis OS are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Comprehensive `.env.example` documenting all 212 referenced environment variables, grouped into 13 commented sections.
- Expanded `.gitignore` covering server build output, agent scratchpads, native build artifacts, IDE state, and runtime caches.
- `LICENSE` (MIT), `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`.
- `.editorconfig` for consistent whitespace/line-ending handling across editors and platforms.
- `.npmrc` with `engine-strict=true` to enforce Node/npm version pins from `package.json`.
- GitHub Actions CI workflow (`.github/workflows/ci.yml`).
- Dockerfile and `.dockerignore` for a single canonical container build.

### Changed
- Untracked `server_dist/index.js` (4MB) and `attached_assets/` (~60MB of agent scratchpads) so future clones stay small.

### Removed
- 149 `attached_assets/` files (debug screenshots, agent prompts, ephemeral planning notes) — recoverable from git history if needed.

## [Pre-history]

Prior to this changelog the project was developed on Replit under the
`codex/replit-main-continuation` branch without formal release notes.
See the git log for that history: `git log codex/replit-main-continuation`.
