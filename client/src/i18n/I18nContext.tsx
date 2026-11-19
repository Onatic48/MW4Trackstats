import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { en } from './en';
import { tr } from './tr';
import type { Locale, Translations } from './types';

const STORAGE_KEY = 'mw4trackstats.locale';

const DICTIONARIES: Record<Locale, Translations> = {
  en,
  tr,
};

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: Translations;
  formatNumber: (value: number | null | undefined, fractionDigits?: number) => string;
  formatDurationMinutes: (minutes: number | null | undefined) => string;
  formatRelativeTime: (isoDate: string) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function readInitialLocale(): Locale {
  if (typeof window === 'undefined') {
    return 'en';
  }
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'tr') {
      return saved;
    }
  } catch {
    // Ignore storage read restrictions
  }
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  useEffect(() => {
    document.documentElement.lang = locale;
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Ignore storage write restrictions
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  const t = DICTIONARIES[locale];

  const formatNumber = useCallback(
    (value: number | null | undefined, fractionDigits?: number): string => {
      if (value === null || value === undefined || !Number.isFinite(value)) {
        return '--';
      }
      const intlLocale = locale === 'tr' ? 'tr-TR' : 'en-US';
      return new Intl.NumberFormat(intlLocale, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(value);
    },
    [locale],
  );

  const formatDurationMinutes = useCallback(
    (minutes: number | null | undefined): string => {
      if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) {
        return '--';
      }
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      const mins = Math.round(minutes % 60);
      if (days > 0) {
        return `${days}${t.time.daysShort} ${hours}${t.time.hoursShort}`;
      }
      if (hours > 0) {
        return `${hours}${t.time.hoursShort} ${mins}${t.time.minutesShort}`;
      }
      return `${mins}${t.time.minutesShort}`;
    },
    [t],
  );

  const formatRelativeTime = useCallback(
    (isoDate: string): string => {
      const diffMs = Math.max(0, Date.now() - Date.parse(isoDate));
      const diffMinutes = Math.floor(diffMs / 60_000);
      if (diffMinutes < 1) {
        return t.time.justNow;
      }
      if (diffMinutes < 60) {
        return `${diffMinutes}${t.time.minutesAgo}`;
      }
      const diffHours = Math.floor(diffMinutes / 60);
      return `${diffHours}${t.time.hoursAgo}`;
    },
    [t],
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      formatNumber,
      formatDurationMinutes,
      formatRelativeTime,
    }),
    [locale, setLocale, t, formatNumber, formatDurationMinutes, formatRelativeTime],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}
