#!/usr/bin/env node
import { QuarryError } from 'core';

import { run } from './program.js';

run(process.argv).catch((error: unknown) => {
  if (error instanceof QuarryError) {
    const where = error.stage === undefined ? '' : ` [${error.stage}]`;
    console.error(`quarry${where}: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
