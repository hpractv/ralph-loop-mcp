import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

export default function globalSetup() {
  const distEntry = join(process.cwd(), 'dist', 'index.js');
  if (!existsSync(distEntry)) {
    console.log('[globalSetup] dist/index.js not found -- running tsc...');
    execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' });
    console.log('[globalSetup] build complete.');
  }
}
