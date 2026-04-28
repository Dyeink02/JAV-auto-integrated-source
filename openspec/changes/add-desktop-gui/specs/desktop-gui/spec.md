## ADDED Requirements

### Requirement: Windows Desktop GUI
The system SHALL provide a Windows desktop graphical interface for the crawler so users can start a crawl without manually typing CLI commands.

#### Scenario: User starts a crawl from the GUI
- **WHEN** the user fills in the desktop form and clicks the start button
- **THEN** the system starts the crawler with the selected options
- **AND** the GUI shows live status and logs during execution

### Requirement: Desktop Configuration Inputs
The desktop GUI SHALL expose the most common crawler options as form controls.

#### Scenario: User edits crawler settings
- **WHEN** the user opens the desktop application
- **THEN** they can edit the base URL, output directory, crawl limit, parallel count, delay, timeout, proxy, Cloudflare bypass, skip-no-magnet, fetch-all-magnets, and skip-image options

### Requirement: Windows Executable Packaging
The project SHALL produce Windows executable artifacts for the desktop GUI.

#### Scenario: Maintainer builds desktop artifacts
- **WHEN** the maintainer runs the desktop packaging command
- **THEN** the project outputs Windows executable files under the `release/` directory
