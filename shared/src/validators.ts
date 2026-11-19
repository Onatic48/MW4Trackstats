export const ACTIVISION_ID_REGEX = /^[^\s#]{1,32}#\d{4,10}$/;

export type ActivisionIdValidationResult =
  | {
      valid: true;
      canonical: string;
      normalized: string;
    }
  | {
      valid: false;
      reason: string;
    };

const CONTROL_CHARS_REGEX = /[\u0000-\u001f\u007f]/;
const URL_REGEX = /https?:\/\//i;

export function validateActivisionId(raw: unknown): ActivisionIdValidationResult {
  if (typeof raw !== 'string') {
    return { valid: false, reason: 'Activision ID must be a non-empty string' };
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return { valid: false, reason: 'Activision ID is required' };
  }

  if (trimmed.length > 43) {
    return { valid: false, reason: 'Activision ID exceeds maximum length of 43 characters' };
  }

  if (CONTROL_CHARS_REGEX.test(trimmed)) {
    return { valid: false, reason: 'Activision ID contains invalid control characters' };
  }

  if (trimmed.includes('@') || URL_REGEX.test(trimmed)) {
    return { valid: false, reason: 'Activision ID cannot contain mentions or URLs' };
  }

  if (!ACTIVISION_ID_REGEX.test(trimmed)) {
    return {
      valid: false,
      reason: 'Activision ID must match Name#1234567 (no spaces, 4-10 digits after #)',
    };
  }

  return {
    valid: true,
    canonical: trimmed,
    normalized: trimmed.toLowerCase(),
  };
}
