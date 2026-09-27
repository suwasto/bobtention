import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';

/**
 * Resolves the directory containing the compiled Bobtention hook scripts.
 */
function resolveHooksDirectory(extensionPath: string, workspaceRoot: string): string | null {
  // 1. Packaged extension runtime: <extensionPath>/runtime/hooks
  const packagedHooks = path.join(extensionPath, 'runtime', 'hooks');
  if (fs.existsSync(path.join(packagedHooks, 'session-start.js'))) {
    return packagedHooks;
  }

  // 2. Monorepo/Development sibling: <extensionPath>/../dist/hooks
  const devHooks = path.resolve(extensionPath, '..', 'dist', 'hooks');
  if (fs.existsSync(path.join(devHooks, 'session-start.js'))) {
    return devHooks;
  }

  // 3. Current workspace local build: <workspaceRoot>/dist/hooks
  const workspaceHooks = path.join(workspaceRoot, 'dist', 'hooks');
  if (fs.existsSync(path.join(workspaceHooks, 'session-start.js'))) {
    return workspaceHooks;
  }

  return null;
}

/**
 * Resolves the absolute path to the `node` binary.
 *
 * Bob hooks run in a non-interactive shell with no PATH, so bare `node`
 * silently fails. process.execPath is intentionally NOT used — in Bob IDE
 * (Electron) it points to the Electron helper binary, not Node.
 *
 * Resolution order:
 *   1. `which node` via a login shell — picks up nvm / volta / homebrew
 *   2. Well-known fixed install paths on macOS / Linux
 */
function resolveNodeBin(): string | null {
  // 1. Login shell which — most reliable, respects version managers
  try {
    const shell = process.env.SHELL || '/bin/bash';
    const result = execFileSync(shell, ['-lc', 'which node'], {
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    if (result && fs.existsSync(result)) {
      return result;
    }
  } catch {
    // fall through
  }

  // 2. Well-known fixed paths
  const candidates = [
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/bin/node',
    path.join(os.homedir(), '.nvm', 'current', 'bin', 'node'),
    path.join(os.homedir(), '.volta', 'bin', 'node'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

export function activate(context: vscode.ExtensionContext) {
  // ─── Command: Initialize Workspace ──────────────────────────────────────────
  const initDisposable = vscode.commands.registerCommand(
    'bobtention.initializeWorkspace',
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage(
          'Bobtention: No workspace folder is currently open. Please open a project first.'
        );
        return;
      }

      let targetFolder: vscode.WorkspaceFolder;
      if (workspaceFolders.length === 1) {
        targetFolder = workspaceFolders[0];
      } else {
        const picked = await vscode.window.showWorkspaceFolderPick({
          placeHolder: 'Select the workspace folder to initialize Bobtention in',
        });
        if (!picked) {
          return;
        }
        targetFolder = picked;
      }

      const rootPath = targetFolder.uri.fsPath;

      try {
        // 1. Locate hook scripts
        const hooksDir = resolveHooksDirectory(context.extensionPath, rootPath);
        if (!hooksDir) {
          vscode.window.showErrorMessage(
            'Bobtention: Could not find compiled hook scripts. Ensure Bobtention is built ("npm run build").'
          );
          return;
        }

        // 2. Ensure home & workspace session/log storage directories exist
        const homeDir = os.homedir();
        fs.mkdirSync(path.join(homeDir, '.bobtention', 'sessions'), { recursive: true });
        fs.mkdirSync(path.join(homeDir, '.bobtention', 'logs'), { recursive: true });
        fs.mkdirSync(path.join(rootPath, '.bobtention', 'sessions'), { recursive: true });
        fs.mkdirSync(path.join(rootPath, '.bobtention', 'logs'), { recursive: true });

        // 3. Ensure default bobtention.config.json exists
        const configPath = path.join(rootPath, 'bobtention.config.json');
        let configCreated = false;
        if (!fs.existsSync(configPath)) {
          const defaultConfig = {
            enabled: true,
            decisionEngine: {
              provider: 'laya',
              endpoint: 'http://localhost:8000/v1/systemone',
              timeout: 3000,
            },
            autonomy: {
              watchThreshold: 0.55,
              blockThreshold: 0.85,
            },
            signals: {
              taskDrift: true,
              repeatedFailure: true,
              scopeExpansion: true,
              highImpactAction: true,
              uncertainty: true,
            },
            highImpactPatterns: [
              { pattern: 'delete|remove|drop|truncate', category: 'destructive' },
              { pattern: 'migration|schema', category: 'schema-change' },
              { pattern: '\\.env|secret|credential|password|token|key', category: 'credentials' },
              { pattern: 'deploy|release|publish', category: 'deployment' },
            ],
            humanOverride: { enabled: true },
            session: { maxActions: 50 },
          };
          fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', 'utf-8');
          configCreated = true;
        }

        // 4. Merge hooks into .bob/settings.json
        const bobDir = path.join(rootPath, '.bob');
        const settingsPath = path.join(bobDir, 'settings.json');
        fs.mkdirSync(bobDir, { recursive: true });

        let existingSettings: Record<string, any> = {};
        if (fs.existsSync(settingsPath)) {
          try {
            const rawContent = fs.readFileSync(settingsPath, 'utf-8');
            existingSettings = JSON.parse(rawContent);
          } catch {
            existingSettings = {};
          }
        }

        // Resolve the absolute node binary path so hooks work in Bob's
        // non-interactive shell (no PATH). process.execPath is NOT used —
        // in Bob IDE (Electron) it resolves to the Electron helper, not Node.
        const nodeBin = resolveNodeBin();
        if (!nodeBin) {
          vscode.window.showErrorMessage(
            'Bobtention: Could not locate the Node.js binary. ' +
            'Ensure Node.js ≥18 is installed and available in your shell PATH, then retry.'
          );
          return;
        }

        const sessionStartJs = path.join(hooksDir, 'session-start.js');
        const userPromptSubmitJs = path.join(hooksDir, 'user-prompt-submit.js');
        const preToolUseJs = path.join(hooksDir, 'pre-tool-use.js');
        const postToolUseJs = path.join(hooksDir, 'post-tool-use.js');
        const stopJs = path.join(hooksDir, 'stop.js');

        const updatedHooks = {
          ...(existingSettings.hooks || {}),
          SessionStart: [
            {
              matcher: '.*',
              hooks: [
                {
                  type: 'command',
                  command: `"${nodeBin}" "${sessionStartJs}"`,
                  timeout: 5,
                },
              ],
            },
          ],
          UserPromptSubmit: [
            {
              matcher: '.*',
              hooks: [
                {
                  type: 'command',
                  command: `"${nodeBin}" "${userPromptSubmitJs}"`,
                  timeout: 5,
                },
              ],
            },
          ],
          PreToolUse: [
            {
              matcher: '.*',
              hooks: [
                {
                  type: 'command',
                  command: `"${nodeBin}" "${preToolUseJs}"`,
                  timeout: 10,
                },
              ],
            },
          ],
          PostToolUse: [
            {
              matcher: '.*',
              hooks: [
                {
                  type: 'command',
                  command: `"${nodeBin}" "${postToolUseJs}"`,
                  timeout: 5,
                },
              ],
            },
          ],
          Stop: [
            {
              matcher: '.*',
              hooks: [
                {
                  type: 'command',
                  command: `"${nodeBin}" "${stopJs}"`,
                  timeout: 5,
                },
              ],
            },
          ],
        };

        existingSettings.hooks = updatedHooks;
        fs.writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2) + '\n', 'utf-8');

        // 5. Success feedback with quick navigation
        const action = await vscode.window.showInformationMessage(
          `✓ Bobtention initialized in ${targetFolder.name}! (node: ${nodeBin})`,
          'Open .bob/settings.json',
          'Open bobtention.config.json'
        );

        if (action === 'Open .bob/settings.json') {
          const doc = await vscode.workspace.openTextDocument(settingsPath);
          await vscode.window.showTextDocument(doc);
        } else if (action === 'Open bobtention.config.json') {
          const doc = await vscode.workspace.openTextDocument(configPath);
          await vscode.window.showTextDocument(doc);
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(
          `Bobtention initialization failed: ${err?.message ?? String(err)}`
        );
      }
    }
  );

  // ─── Command: Remove Hooks from Workspace ────────────────────────────────────
  const removeDisposable = vscode.commands.registerCommand(
    'bobtention.removeHooks',
    async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('Bobtention: No workspace folder is currently open.');
        return;
      }

      const rootPath = workspaceFolders[0].uri.fsPath;
      const settingsPath = path.join(rootPath, '.bob', 'settings.json');

      if (!fs.existsSync(settingsPath)) {
        vscode.window.showInformationMessage('No .bob/settings.json file found in workspace.');
        return;
      }

      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        if (settings.hooks) {
          const hookNames = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
          for (const name of hookNames) {
            delete settings.hooks[name];
          }
          if (Object.keys(settings.hooks).length === 0) {
            delete settings.hooks;
          }
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
          vscode.window.showInformationMessage('✓ Bobtention hooks removed from .bob/settings.json.');
        } else {
          vscode.window.showInformationMessage('No hooks found in .bob/settings.json.');
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to remove hooks: ${err?.message ?? String(err)}`);
      }
    }
  );

  context.subscriptions.push(initDisposable, removeDisposable);
}

export function deactivate() {}
