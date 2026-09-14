import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const source = readFileSync(resolve(root, 'docs/openapi.yaml'), 'utf8');
if (!source.startsWith('openapi: 3.1.0\n')) throw new Error('OpenAPI must be version 3.1.0');
const pathsIndex = source.indexOf('\npaths:\n');
const componentsIndex = source.indexOf('\ncomponents:\n');
if (componentsIndex < 0 || pathsIndex < 0 || componentsIndex > pathsIndex)
  throw new Error('OpenAPI components must be declared before paths');
for (const section of ['parameters', 'requestBodies', 'responses']) {
  if (!new RegExp(`^  ${section}:`, 'm').test(source))
    throw new Error(`OpenAPI components.${section} is missing`);
}
for (const route of [
  '/v1/capabilities:',
  '/users/me/export:',
  '/documents/{documentId}/parse:',
  '/tasks/{taskId}/notices:',
  '/tasks/{taskId}/notice-sync:',
  '/tasks/{taskId}/notice-sync/{syncEventId}/resolve:',
  '/notices/{noticeId}/revisions:',
]) {
  if (!source.includes(`  ${route}`)) throw new Error(`OpenAPI route is missing: ${route}`);
}
for (const component of [
  'components/parameters/IdempotencyKey',
  'components/parameters/SyncEventId',
  'components/requestBodies/NoticeTaskLink',
  'components/requestBodies/NoticeSyncResolution',
]) {
  if (!source.includes(`'#/` + component + `'`))
    throw new Error(`OpenAPI reference is missing: ${component}`);
}
console.log('OpenAPI structure check passed');
