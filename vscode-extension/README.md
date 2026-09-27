# Bobtention for VS Code

One-click workspace setup and hook management for [Bobtention](https://github.com/suwasto/bobtention) — the human attention router for IBM Bob.

## Features

- **One-Click Workspace Setup:** Run `Bobtention: Initialize Workspace` from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
  - Automatically merges the 5 required hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`) into `.bob/settings.json`.
  - Creates a default `bobtention.config.json` if absent.
  - Prepares `~/.bobtention/` and workspace session/log storage.
- **Hook Removal / Reset:** Run `Bobtention: Remove Hooks from Workspace` to cleanly detach Bobtention from your `.bob/settings.json` without altering other settings.

## Quick Install (any Bob workspace)

Install the **Bobtention** plugin directly from the Bob IDE:

1. Open the Bob IDE.
2. Navigate to the **Extensions / Plugins** panel.
3. Search for **Bobtention** and click **Install**.
4. Open your workspace — Bobtention hooks are applied automatically.

## Usage

1. Open your project folder in VS Code.
2. Open Command Palette: `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux).
3. Type and select **`Bobtention: Initialize Workspace`**.
4. That's it! Your IBM Bob sessions in this workspace will now run with Bobtention attention routing.

## Development & Publishing

### Compile
```bash
npm install
npm run compile
```

### Package into .vsix
```bash
npm run package
```

### Install locally
```bash
code --install-extension bobtention-vscode-0.1.0.vsix
```

### Publish to VS Code Marketplace
```bash
npx @vscode/vsce publish
```
