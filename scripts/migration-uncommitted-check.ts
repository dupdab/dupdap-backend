#!/usr/bin/env ts-node
/**
 * CI check: fails if there are uncommitted migration files.
 * Ensures generated migrations are always committed before merging.
 */
import { execSync } from 'child_process';

let output = '';
try {
  output = execSync('git status --porcelain src/database/migrations/', { encoding: 'utf8' });
} catch (err) {
  console.error('ERROR: Failed to inspect migration directory via git status.');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

if (output.trim().length > 0) {
  console.error('ERROR: Uncommitted migration files detected:');
  console.error(output);
  console.error('');
  console.error('A migration was generated but not committed. To fix this:');
  console.error('  1. Generate the migration if you have not already:');
  console.error('       npm run migration:generate -- src/database/migrations/<Name>');
  console.error('  2. Review the generated file under src/database/migrations/.');
  console.error('  3. Stage and commit it:');
  console.error('       git add src/database/migrations/');
  console.error('       git commit -m "chore: add migration"');
  console.error('  4. Push your branch so CI can re-run this check.');
  process.exit(1);
}

console.log('Migration check passed: no uncommitted migration files.');
