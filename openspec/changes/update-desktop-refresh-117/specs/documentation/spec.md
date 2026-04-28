## ADDED Requirements

### Requirement: Versioned Desktop Release Notes
Each substantial desktop release MUST include a versioned markdown note under `docs/` that summarizes the visual, runtime, and release changes.

#### Scenario: User checks what changed in a desktop release
- **WHEN** a desktop version is iterated for a significant UI or runtime update
- **THEN** the repository includes a versioned markdown note for that release
- **AND** the note explains the main UI changes
- **AND** the note explains the main runtime or crawler changes

### Requirement: Release Test Record
Each substantial desktop release MUST include a markdown test record with the commands used and the measured outcomes.

#### Scenario: Maintainer verifies a release candidate
- **WHEN** a release is prepared for distribution
- **THEN** the repository includes a test record for that version
- **AND** the record lists the build/test status
- **AND** the record lists the real-world smoke-test targets and outcomes

### Requirement: Background Attribution
Desktop release notes MUST document the source and license of bundled background artwork.

#### Scenario: User or maintainer checks bundled image provenance
- **WHEN** desktop artwork is bundled into the app
- **THEN** the release note states the image source
- **AND** the release note states the license or attribution requirement
