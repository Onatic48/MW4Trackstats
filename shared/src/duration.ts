const EMPTY_MARKERS = new Set(['', '--', '-', 'n/a', 'na', 'null', 'none']);

export function parseDurationToMinutes(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  if (EMPTY_MARKERS.has(trimmed.toLowerCase())) {
    return null;
  }

  const tokenRegex = /(\d+)\s*([dhm])/gi;
  let match: RegExpExecArray | null = tokenRegex.exec(trimmed);
  let totalMinutes = 0;
  let matched = false;

  while (match !== null) {
    const amountRaw = match[1];
    const unitRaw = match[2];
    if (amountRaw && unitRaw) {
      const amount = Number.parseInt(amountRaw, 10);
      const unit = unitRaw.toLowerCase();
      if (Number.isFinite(amount)) {
        matched = true;
        if (unit === 'd') {
          totalMinutes += amount * 1440;
        } else if (unit === 'h') {
          totalMinutes += amount * 60;
        } else if (unit === 'm') {
          totalMinutes += amount;
        }
      }
    }
    match = tokenRegex.exec(trimmed);
  }

  return matched ? totalMinutes : null;
}

export function normalizeStatNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (EMPTY_MARKERS.has(trimmed.toLowerCase())) {
    return null;
  }

  const cleaned = trimmed.replace(/,/g, '').replace(/%$/, '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) {
    return null;
  }

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeStatString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (EMPTY_MARKERS.has(trimmed.toLowerCase())) {
    return null;
  }
  return trimmed;
}
