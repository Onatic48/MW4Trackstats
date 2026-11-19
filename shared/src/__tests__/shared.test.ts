import { describe, it, expect } from 'vitest';
import {
  validateActivisionId,
  parseDurationToMinutes,
  normalizeStatNumber,
  normalizeStatString,
} from '../index.js';

describe('validateActivisionId', () => {
  it('accepts standard Activision IDs and preserves canonical casing', () => {
    const res = validateActivisionId('  CaptainPrice#1412123  ');
    expect(res).toEqual({
      valid: true,
      canonical: 'CaptainPrice#1412123',
      normalized: 'captainprice#1412123',
    });
  });

  it('accepts Unicode/Turkish prefixes like #5745488 sample', () => {
    const res = validateActivisionId('Şahin#5745488');
    expect(res).toEqual({
      valid: true,
      canonical: 'Şahin#5745488',
      normalized: 'şahin#5745488',
    });
  });

  it('rejects mentions, URLs, newlines, and invalid formats', () => {
    expect(validateActivisionId('@CODCombatRecord#1234').valid).toBe(false);
    expect(validateActivisionId('https://x.com/test#1234').valid).toBe(false);
    expect(validateActivisionId('Ghost\n#1234').valid).toBe(false);
    expect(validateActivisionId('Ghost#123').valid).toBe(false);
    expect(validateActivisionId('Ghost').valid).toBe(false);
    expect(validateActivisionId('Ghost 123#12345').valid).toBe(false);
    expect(validateActivisionId('').valid).toBe(false);
  });
});

describe('duration and stat normalization', () => {
  it('parses CoD combat record duration strings accurately', () => {
    expect(parseDurationToMinutes('14M')).toBe(14);
    expect(parseDurationToMinutes('1H 34M')).toBe(94);
    expect(parseDurationToMinutes('4D 18H')).toBe(6840);
    expect(parseDurationToMinutes('2d 3h 15m')).toBe(3075);
    expect(parseDurationToMinutes('0M')).toBe(0);
    expect(parseDurationToMinutes('--')).toBeNull();
    expect(parseDurationToMinutes('')).toBeNull();
    expect(parseDurationToMinutes(null)).toBeNull();
  });

  it('distinguishes "--" null from real 0 / 0.00 stat values', () => {
    expect(normalizeStatNumber('--')).toBeNull();
    expect(normalizeStatNumber('')).toBeNull();
    expect(normalizeStatNumber(null)).toBeNull();
    expect(normalizeStatNumber('0.00')).toBe(0);
    expect(normalizeStatNumber('0')).toBe(0);
    expect(normalizeStatNumber(0)).toBe(0);
    expect(normalizeStatNumber('1.33')).toBe(1.33);
    expect(normalizeStatNumber('39,101')).toBe(39101);
    expect(normalizeStatNumber('30.00%')).toBe(30);
    expect(normalizeStatNumber('0.00%')).toBe(0);
  });

  it('normalizes empty dash strings to null while preserving labels', () => {
    expect(normalizeStatString('--')).toBeNull();
    expect(normalizeStatString('  1H 34M  ')).toBe('1H 34M');
  });
});
