## Context
The desktop AED package is now the primary delivery line. Correctness issues in completion status and queue reconciliation create user-visible false positives, and large tasks suffer when fast magnet requests and Cloudflare recovery share one queue.

## Goals / Non-Goals
- Goals:
  - Make completion status trustworthy
  - Persist enough reconciliation data for resume, validation, and diagnostics
  - Separate fast-path HTTP magnet work from Cloudflare recovery work
  - Keep the packaged AED mode explicit in runtime logs
- Non-Goals:
  - Redesign the UI layout
  - Introduce a new distributed worker model

## Decisions
- Decision: use `expectedIds` as the authoritative reconciliation baseline
  - Alternatives considered: continue using `queued - processed`; rejected because it misses processed-but-not-persisted cases and queue-gap cases
- Decision: split detail processing into metadata parsing → fast HTTP magnet queue → Cloudflare recovery queue
  - Alternatives considered: keep a monolithic detail queue; rejected because it keeps slow recovery work on the main hot path
- Decision: mark incomplete runs with a dedicated final status instead of reusing `completed`
  - Alternatives considered: continue with `completed` plus warnings; rejected because it misleads users

## Risks / Trade-offs
- More state is persisted to disk, increasing snapshot size slightly
- Recovery queues add orchestration complexity, but isolate slow paths and improve throughput stability

## Migration Plan
1. Persist new reconciliation fields with backward-tolerant restore logic
2. Ship packaged AED defaults in `1.1.15`
3. Keep existing result files compatible while expanding validation output
