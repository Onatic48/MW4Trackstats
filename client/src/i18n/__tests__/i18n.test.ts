import { describe, it, expect } from 'vitest';
import { en } from '../en';
import { tr } from '../tr';

function flattenKeys(obj: Record<string, unknown>, prefix = ''): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      entries.push([path, value]);
    } else if (value && typeof value === 'object') {
      entries.push(...flattenKeys(value as Record<string, unknown>, path));
    }
  }
  return entries;
}

describe('i18n dictionaries', () => {
  it('keeps identical key sets and avoids unslop-prohibited exclamation marks', () => {
    const enEntries = flattenKeys(en as unknown as Record<string, unknown>);
    const trEntries = flattenKeys(tr as unknown as Record<string, unknown>);

    expect(enEntries.map(([k]) => k)).toEqual(trEntries.map(([k]) => k));

    for (const [key, val] of [...enEntries, ...trEntries]) {
      expect(val.trim().length, `Empty string at ${key}`).toBeGreaterThan(0);
      expect(val.includes('!'), `Exclamation mark found at ${key}`).toBe(false);
    }
  });
});
