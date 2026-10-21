/** Generate route metadata without connecting to databases, queues, or RPC services. */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createOpenApiDocument } from '../src/common/swagger';

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
}
export async function documentationApp() {
  const typeormNest = require('@nestjs/typeorm');
  typeormNest.InjectRepository = () => () => undefined;
  typeormNest.InjectDataSource = () => () => undefined;
  const controllers = files(join(__dirname, '../src')).filter(file => file.endsWith('.controller.ts'))
    .flatMap(file => Object.values(require(file)))
    .filter((value: any) => typeof value === 'function' && Reflect.hasMetadata('path', value)) as any[];
  const dependencies = new Set<any>();
  const guards = new Set<any>();
  for (const controller of controllers) {
    for (const dependency of Reflect.getMetadata('design:paramtypes', controller) ?? []) dependencies.add(dependency);
    for (const dependency of Reflect.getMetadata('self:paramtypes', controller) ?? []) dependencies.add(dependency.param);
    for (const target of [controller, ...Object.getOwnPropertyNames(controller.prototype).map(key => controller.prototype[key])]) {
      if (typeof target !== 'function') continue;
      for (const guard of Reflect.getMetadata('__guards__', target) ?? []) guards.add(guard);
    }
  }
  let builder = Test.createTestingModule({ controllers, providers: [...dependencies].map(provide => ({ provide, useValue: {} })) });
  for (const guard of guards) builder = builder.overrideGuard(guard).useValue({ canActivate: () => true });
  const module = await builder.compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  return app;
}
async function main() {
  const app = await documentationApp();
  try {
    const document = createOpenApiDocument(app, require('../package.json').version);
    writeFileSync(process.argv[2] ?? 'openapi.json', JSON.stringify(document, null, 2) + '\n');
  } finally { await app.close(); }
}
if (require.main === module) void main();
