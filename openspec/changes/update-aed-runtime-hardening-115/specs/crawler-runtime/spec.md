## ADDED Requirements
### Requirement: AED Run Completion Reconciliation
The system SHALL only mark an AED scraping run as completed when all expected item identities have been persisted and no queue reconciliation gaps remain.

#### Scenario: Missing expected item prevents completion
- **WHEN** the runtime has one or more `expectedIds` that are absent from `persistedIds`
- **THEN** the final run status is not `completed`
- **AND** the final message explains that the task is incomplete

#### Scenario: Queue gap is persisted for diagnostics
- **WHEN** index parsing yields an expected item identity that was never queued
- **THEN** the runtime stores that gap in `task-state.json`
- **AND** the validator reports the queue gap during second validation

### Requirement: Split Magnet Recovery Pipeline
The system SHALL process large AED runs through separate index, fast HTTP magnet, and Cloudflare recovery queues.

#### Scenario: Fast queue falls back to Cloudflare recovery
- **WHEN** a fast HTTP magnet request does not return a usable magnet payload
- **THEN** the item is moved into the dedicated Cloudflare recovery queue
- **AND** the detail metadata is preserved for final persistence

#### Scenario: Runtime mode is explicit in packaged logs
- **WHEN** the desktop AED package starts a run
- **THEN** the task log header includes the packaged runtime mode
- **AND** the request layer logs the active runtime scheme at startup
