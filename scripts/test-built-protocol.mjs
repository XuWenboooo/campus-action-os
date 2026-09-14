import { readFile } from 'node:fs/promises';

const protocol = await import('../dist/packages/protocol/src/index.js');
const schema = protocol.loadSchema('verified-action-object');
const textRequestSchema = protocol.loadSchema('text-parse-request');
const assessmentSchema = protocol.loadSchema('document-assessment');
const textResponseSchema = protocol.loadSchema('text-parse-response');
const graph = JSON.parse(await readFile('examples/action-graphs/branch-and-revision.json', 'utf8'));
if (
  schema?.$id === undefined ||
  textRequestSchema?.$id === undefined ||
  assessmentSchema?.$id === undefined ||
  textResponseSchema?.$id === undefined ||
  !protocol.validateActionGraph(graph).ok
) {
  console.error('Built protocol cannot load copied schemas or validate the graph example.');
  process.exit(1);
}
console.log('Built protocol schema loading and runtime validation passed');
