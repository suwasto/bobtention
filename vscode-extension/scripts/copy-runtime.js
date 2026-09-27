/**
 * Copies the compiled dist/ runtime from the main bobtention repo
 * into the extension's runtime/ directory so it's packaged inside the .vsix.
 *
 * Also vendors the external npm dependencies required by the runtime
 * (minimatch + its transitive deps) so the hooks are self-contained and
 * work without a node_modules directory next to them.
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const srcDir = path.join(repoRoot, 'dist');
const destDir = path.resolve(__dirname, '..', 'runtime');

if (!fs.existsSync(srcDir)) {
  console.warn('Warning: Main dist/ directory not found at ' + srcDir);
  console.warn('Run "npm run build" in the root directory first.');
  process.exit(0);
}

// Copy compiled runtime
fs.rmSync(destDir, { recursive: true, force: true });
fs.cpSync(srcDir, destDir, { recursive: true });
console.log('✓ Runtime successfully copied to vscode-extension/runtime');

// Vendor external dependencies so the runtime is self-contained.
// The only external require() in the compiled output is `minimatch`.
const vendorDeps = ['minimatch', 'brace-expansion', 'balanced-match'];
const vendorDest = path.join(destDir, 'node_modules');
fs.mkdirSync(vendorDest, { recursive: true });

for (const dep of vendorDeps) {
  const depSrc = path.join(repoRoot, 'node_modules', dep);
  if (!fs.existsSync(depSrc)) {
    console.error(`ERROR: node_modules/${dep} not found — run "npm install" in repo root first.`);
    process.exit(1);
  }
  fs.cpSync(depSrc, path.join(vendorDest, dep), { recursive: true });
}
console.log('✓ Vendored dependencies: ' + vendorDeps.join(', '));
