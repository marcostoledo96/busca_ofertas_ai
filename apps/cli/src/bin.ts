#!/usr/bin/env node
import { runCli } from './composition-root.js';
import { EXIT_CODES } from './runtime/exit-codes.js';

runCli()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch(() => {
    process.stderr.write('\n[INTERNAL_ERROR] Ocurrió un error interno no esperado.\n');
    process.exitCode = EXIT_CODES.INTERNAL_ERROR;
  });
