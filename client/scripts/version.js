import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
  const packagePath = join(__dirname, '..', '..', 'package.json');
  const version = JSON.parse(readFileSync(packagePath, 'utf8')).version;
  const versionFile = join(__dirname, '..', 'src', 'version.ts');
  writeFileSync(versionFile, `export const VERSION = '${version}';\n`);
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}