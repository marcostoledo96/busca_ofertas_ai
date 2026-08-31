import { describe, it, expect } from 'vitest';
import {
  FakeTerminal,
  TerminalProgressReporter,
  InMemoryProgressReporter,
  type ProgressStep,
} from '@busca-ofertas-ai/cli';

describe('CLI Progress Presentation (BOAI-006)', () => {
  it('formats progress steps as [current/total] label in textual terminal renderer', () => {
    const terminal = new FakeTerminal();
    const reporter = new TerminalProgressReporter(terminal);

    const steps: ProgressStep[] = [
      { current: 1, total: 6, label: 'Validando configuración' },
      { current: 2, total: 6, label: 'Comprobando Facebook Marketplace' },
      { current: 3, total: 6, label: 'Recolectando publicaciones' },
      { current: 4, total: 6, label: 'Resolviendo precios y aplicando reglas' },
      { current: 5, total: 6, label: 'Guardando historial' },
      { current: 6, total: 6, label: 'Generando reporte' },
    ];

    for (const step of steps) {
      reporter.report(step);
    }

    const lines = terminal.getOutputLines();
    expect(lines).toEqual([
      '[1/6] Validando configuración',
      '[2/6] Comprobando Facebook Marketplace',
      '[3/6] Recolectando publicaciones',
      '[4/6] Resolviendo precios y aplicando reglas',
      '[5/6] Guardando historial',
      '[6/6] Generando reporte',
    ]);
  });

  it('records progress steps in InMemoryProgressReporter for headless validation', () => {
    const reporter = new InMemoryProgressReporter();

    reporter.report({ current: 1, total: 3, label: 'Step 1' });
    reporter.report({ current: 2, total: 3, label: 'Step 2' });
    reporter.report({ current: 3, total: 3, label: 'Step 3' });

    expect(reporter.getSteps()).toEqual([
      { current: 1, total: 3, label: 'Step 1' },
      { current: 2, total: 3, label: 'Step 2' },
      { current: 3, total: 3, label: 'Step 3' },
    ]);

    reporter.clear();
    expect(reporter.getSteps()).toHaveLength(0);
  });
});
