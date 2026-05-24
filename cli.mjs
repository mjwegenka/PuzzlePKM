#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { main, __testing } from './cli/app.mjs';

export { __testing };

const isDirectExecution = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectExecution) {
  await main();
}
