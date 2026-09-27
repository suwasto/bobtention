/**
 * Copies the compiled dist/ runtime from the main bobtention repo
 * into the extension's runtime/ directory so it's packaged inside the .vsix.
 */
const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..', '..', 'dist');
const destDir = path.resolve(__dirname, '..', 'runtime');

if (!fs.existsSync(srcDir)) {
  console.warn('Warning: Main dist/ directory not found at ' + srcDir);
  console.warn('Run "npm run build" in the root directory first.');
  process.exit(0);
}

fs.rmSync(destDir, { recursive: true, force: true });
fs.cpSync(srcDir, destDir, { recursive: true });
console.log('✓ Runtime successfully copied to vscode-extension/runtime');
