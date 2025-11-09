/**
 * Post-build script to add .js extensions to relative imports for ESM compatibility
 * This is required because TypeScript doesn't automatically add extensions when compiling to ESM
 */

const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'dist');

function addJsExtensions(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');

  // Add .js to relative imports that don't already have an extension
  // Matches: from './path' or from '../path' but not './path.js' or './path.css'
  content = content.replace(
    /from ['"](\.[^'"]*?)(?<!\.js|\.css|\.json)['"]/g,
    "from '$1.js'"
  );

  fs.writeFileSync(filePath, content, 'utf8');
}

function processDirectory(dir) {
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      processDirectory(fullPath);
    } else if (item.endsWith('.js')) {
      console.log(`Adding .js extensions to: ${path.relative(distDir, fullPath)}`);
      addJsExtensions(fullPath);
    }
  }
}

console.log('Post-build: Adding .js extensions to imports...');
processDirectory(distDir);
console.log('✓ Done!');
