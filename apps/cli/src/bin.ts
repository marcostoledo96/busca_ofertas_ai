#!/usr/bin/env node
import { runCli } from './composition-root.js';
import { EXIT_CODES } from './runtime/exit-codes.js';

runCli()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((err) => {
    process.stderr.write(
      `\n[INTERNAL_ERROR] Fatal error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = EXIT_CODES.INTERNAL_ERROR;
  });
