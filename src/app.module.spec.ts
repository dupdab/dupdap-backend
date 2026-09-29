import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for issue #127: AppModule referenced DatabaseModule in its
 * `@Module({ imports: [...] })` array without importing it, which is a
 * ReferenceError at module-evaluation time and prevents the Nest application
 * from bootstrapping.
 *
 * This test statically inspects src/app.module.ts and asserts that every
 * identifier referenced in the imports array is actually imported (or defined)
 * in the file, so a missing import fails fast.
 */
describe('AppModule imports', () => {
  const appModulePath = join(__dirname, 'app.module.ts');
  const source = readFileSync(appModulePath, 'utf8');

  const importedIdentifiers = new Set<string>();
  const importRegex = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g;
  let importMatch: RegExpExecArray | null;
  while ((importMatch = importRegex.exec(source)) !== null) {
    for (const raw of importMatch[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) {
        importedIdentifiers.add(name);
      }
    }
  }

  const importsArrayMatch = source.match(/imports\s*:\s*\[([\s\S]*?)\]/);
  const importsArray = importsArrayMatch ? importsArrayMatch[1] : '';

  const referencedIdentifiers = new Set<string>();
  const identifierRegex = /\b([A-Z][A-Za-z0-9_]*)\b/g;
  let identifierMatch: RegExpExecArray | null;
  while ((identifierMatch = identifierRegex.exec(importsArray)) !== null) {
    referencedIdentifiers.add(identifierMatch[1]);
  }

  it('imports DatabaseModule', () => {
    expect(importedIdentifiers.has('DatabaseModule')).toBe(true);
  });

  it('imports every module referenced in the imports array', () => {
    const missing = [...referencedIdentifiers].filter(
      (identifier) => !importedIdentifiers.has(identifier),
    );
    expect(missing).toEqual([]);
  });
});
