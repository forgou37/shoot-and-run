# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

History before the first tag lives in the git log and the CLAUDE.md Decisions Log.

## [Unreleased]

### Added
- Production-like development process: PR-based flow with required CI checks, GitHub
  issue/PR templates, a Definition of Done, and tag-triggered releases. See
  [CONTRIBUTING.md](CONTRIBUTING.md).
- Continuous deploy to **GitHub Pages** on every green push to `main`
  (`.github/workflows/deploy.yml`) → https://forgou37.github.io/shoot-and-run/.
  The Vite build uses a relative `base` so assets resolve under the project-pages
  subpath; dev and e2e are unaffected.
