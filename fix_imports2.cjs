const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

function refactorImports(filePath) {
  if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts')) return;
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;

  // We are looking for any import from '../ui/...' or '../../ui/...'
  
  const uiRegex = /import\s+\{([^}]+)\}\s+from\s+['"](?:\.\.\/)+ui\/[^'"]+['"]/g;
  let matches = [];
  let match;
  while ((match = uiRegex.exec(content)) !== null) {
    matches.push(match[1].trim());
  }

  // Remove the old UI imports
  content = content.replace(/import\s+\{([^}]+)\}\s+from\s+['"](?:\.\.\/)+ui\/[^'"]+['"]\n?/g, '');

  if (matches.length > 0) {
    // Collect all destructured names
    const allNames = matches.map(m => m.split(',').map(s => s.trim())).flat().filter(Boolean);
    const uniqueNames = [...new Set(allNames)];
    
    // Check if there's already an import from 'aslan-ui'
    if (content.includes("from 'aslan-ui'")) {
      content = content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]aslan-ui['"]/, (full, existing) => {
        const combined = [...new Set([...existing.split(',').map(s=>s.trim()), ...uniqueNames])].filter(Boolean);
        return `import { ${combined.join(', ')} } from 'aslan-ui'`;
      });
    } else {
      // Prepend it
      // Find the first import
      const lines = content.split('\n');
      const firstImportIndex = lines.findIndex(l => l.startsWith('import '));
      if (firstImportIndex !== -1) {
        lines.splice(firstImportIndex, 0, `import { ${uniqueNames.join(', ')} } from 'aslan-ui';`);
        content = lines.join('\n');
      } else {
        content = `import { ${uniqueNames.join(', ')} } from 'aslan-ui';\n` + content;
      }
    }
  }

  // Fix ./badge in NoteCard
  if (filePath.endsWith('NoteCard.tsx')) {
    content = content.replace(/import\s+\{\s*Badge\s*\}\s+from\s+['"]\.\/badge['"]\n?/, '');
    if (content.includes("from 'aslan-ui'")) {
       content = content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]aslan-ui['"]/, (full, existing) => {
        const combined = [...new Set([...existing.split(',').map(s=>s.trim()), 'Badge'])].filter(Boolean);
        return `import { ${combined.join(', ')} } from 'aslan-ui'`;
      });
    } else {
       const lines = content.split('\n');
      const firstImportIndex = lines.findIndex(l => l.startsWith('import '));
      if (firstImportIndex !== -1) {
        lines.splice(firstImportIndex, 0, `import { Badge } from 'aslan-ui';`);
        content = lines.join('\n');
      } else {
        content = `import { Badge } from 'aslan-ui';\n` + content;
      }
    }
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content);
  }
}

walkDir('/Users/michael/WebProjects/PuzzlePKM/src', refactorImports);
