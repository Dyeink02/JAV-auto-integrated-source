# Change: add Windows desktop GUI packaging

## Why
The project is currently CLI-first, which raises the barrier for non-technical Windows users. A desktop GUI and packaged executable make the crawler easier to use and distribute.

## What Changes
- Add a reusable scraper runner that can be called from both CLI and GUI.
- Add an Electron-based Windows desktop interface with form inputs and live logs.
- Add packaging scripts that produce Windows portable and setup executables.
- Update documentation for the desktop workflow.

## Impact
- Affected specs: `desktop-gui`, `documentation`, `packaging`
- Affected code: `src/core/*`, `src/jav.ts`, `desktop/*`, `package.json`, `README.md`
