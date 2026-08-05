import { describe, expect, it } from 'vitest';

import { dateProblem } from './log-dates';

describe('dateProblem', () => {
  it('accepts a real past date', () => {
    expect(dateProblem('2019-07-21')).toBeNull();
  });

  it('rejects the wrong shape with the format spelled out', () => {
    expect(dateProblem('21/07/2019')).toMatch(/YYYY-MM-DD/);
    expect(dateProblem('2019-7-21')).toMatch(/YYYY-MM-DD/);
    expect(dateProblem('')).toMatch(/YYYY-MM-DD/);
  });

  it('rejects a date that never existed', () => {
    expect(dateProblem('2019-02-30')).toBe("That date doesn't exist.");
    expect(dateProblem('2019-13-01')).toBe("That date doesn't exist.");
  });

  it('rejects the future — the log is a history', () => {
    const next = new Date();
    next.setFullYear(next.getFullYear() + 1);
    const iso = `${next.getFullYear()}-01-01`;
    expect(dateProblem(iso)).toBe('The log is for shows that already happened.');
  });

  it('accepts today', () => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    expect(dateProblem(today)).toBeNull();
  });
});
