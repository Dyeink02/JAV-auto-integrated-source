# Change: Update AED runtime hardening and queue pipeline

## Why
Large AED tasks could incorrectly mark runs as completed while items were still missing, and the single heavy detail queue limited throughput during magnet collection.

## What Changes
- Tighten completion rules so any missing expected item keeps the run out of the completed state
- Change second validation to reconcile `expectedIds - persistedIds`
- Persist queue reconciliation data into `task-state.json`
- Fix AE/AED mode isolation by passing runtime mode from the packaged app into the runner
- Split the runtime pipeline into index queue, fast HTTP magnet queue, and dedicated Cloudflare recovery queue

## Impact
- Affected specs: `crawler-runtime`
- Affected code: `src/core/scraperRunner.ts`, `src/core/queueManager.ts`, `src/core/requestHandler.ts`, `src/core/resultValidator.ts`, `desktop/main.js`, `package.json`
