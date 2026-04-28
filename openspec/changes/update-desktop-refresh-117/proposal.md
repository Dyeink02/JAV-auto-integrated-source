# Change: update desktop refresh and limited-run release workflow for 1.1.17

## Why

The 1.1.16 desktop build was functional, but the release still had three gaps:

- the desktop experience did not yet match the user's requested youthful visual direction
- limited runs could overflow during reconciliation and queue recovery
- release documentation and packaging guidance were not explicit enough for versioned desktop drops

## What Changes

- Refresh the desktop shell with a more youthful visual layout and attributed background artwork
- Keep renderer logic modular so future desktop iterations stay maintainable
- Fix limited-run reconciliation so `limit` remains authoritative during queue repair and recovery
- Add versioned markdown release notes and test records for 1.1.17
- Provide and document a lightweight Windows web installer path alongside the offline package

## Impact

- Affected specs: `documentation`, `packaging`
- Affected code: `desktop/*`, `src/core/scraperRunner.ts`, `package.json`, `CHANGELOG.md`, `docs/*`
