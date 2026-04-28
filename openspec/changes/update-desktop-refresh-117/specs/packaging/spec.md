## ADDED Requirements

### Requirement: Lightweight Windows Web Installer
Desktop releases MUST provide a lightweight Windows web installer option in addition to any offline package.

#### Scenario: Maintainer builds a small distribution package
- **WHEN** the maintainer runs the web installer build command
- **THEN** a Windows web installer artifact is produced
- **AND** the installer bootstrap file is materially smaller than the offline installer

### Requirement: Packaging Tradeoff Documentation
Desktop releases MUST document the measured package sizes and the tradeoff between offline and web distribution.

#### Scenario: User evaluates package size
- **WHEN** a desktop release changes packaging or size targets
- **THEN** the release documentation includes measured package sizes
- **AND** the documentation explains whether the small package is a bootstrap installer or a full offline bundle
