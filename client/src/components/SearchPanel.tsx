import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Search } from 'lucide-react';
import { useAccessibleFormSync } from '../hooks/useAccessibleFormSync';
import { useI18n } from '../i18n/I18nContext';

interface SearchPanelProps {
  isSubmitting: boolean;
  serverError: string | null;
  onSubmit: (activisionId: string) => void;
}

const SAMPLE_IDS = ['Onatic#3733397'] as const;

export function SearchPanel({ isSubmitting, serverError, onSubmit }: SearchPanelProps) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isServerInvalid = Boolean(serverError);
  useAccessibleFormSync(inputRef, isServerInvalid);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = inputRef.current;
    if (!input) {
      return;
    }
    if (!input.checkValidity()) {
      input.focus();
      return;
    }
    onSubmit(value.trim());
  };

  const handlePickSample = (sampleId: string) => {
    setValue(sampleId);
    inputRef.current?.removeAttribute('data-server-invalid');
    onSubmit(sampleId);
  };

  return (
    <section className="pt-8 pb-6 border-b border-[var(--border-hairline)]">
      <div className="max-w-3xl">
        <h1 className="text-[28px] md:text-[32px] leading-[1.15] font-medium text-[var(--text-primary)] tracking-[-0.015em]">
          {t.search.headline}
        </h1>
        <p className="mt-2 text-[15px] leading-[22px] text-[var(--text-secondary)]">
          {t.search.description}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 lookup-field" noValidate={false}>
          <div className="flex items-baseline justify-between gap-4 mb-2">
            <label
              htmlFor="activision-id-input"
              className="text-[14px] leading-5 font-medium text-[var(--text-primary)]"
            >
              {t.search.inputLabel}
            </label>
            <span id="activision-id-hint" className="text-[12px] font-mono-tabular text-[var(--text-muted)]">
              {t.search.formatHint}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-[var(--text-muted)]">
                <Search size={16} strokeWidth={1.5} aria-hidden="true" />
              </span>
              <input
                ref={inputRef}
                id="activision-id-input"
                name="activisionId"
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
                pattern="[^\s#]{1,32}#\d{4,10}"
                maxLength={43}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={t.search.placeholder}
                aria-describedby="activision-id-hint"
                aria-invalid="false"
                data-error="activision-id-error"
                data-server-invalid={isServerInvalid ? 'true' : undefined}
                className="lookup-input w-full h-11 pl-10 pr-12 rounded-[8px] font-mono-tabular text-[14px] placeholder:text-[var(--text-muted)]"
              />
              <kbd
                title={t.search.shortcutHint}
                className="hidden sm:inline-flex items-center justify-center absolute right-3 top-1/2 -translate-y-1/2 h-6 min-w-6 px-1.5 rounded-[4px] bg-[var(--bg-card)] border border-[var(--border-hairline)] text-[12px] font-mono-tabular text-[var(--text-muted)]"
              >
                /
              </kbd>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="h-11 px-5 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] font-medium text-[14px] hover:brightness-95 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-[background-color,transform,filter] duration-150 cursor-pointer shrink-0"
            >
              {isSubmitting ? t.search.submittingButton : t.search.submitButton}
            </button>
          </div>

          <div id="activision-id-error" className="field-error-msg">
            <AlertCircle size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
            <span>{serverError ?? t.search.invalidError}</span>
          </div>
        </form>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-[var(--text-muted)] mr-1">
            {t.search.samplePrefix}
          </span>
          {SAMPLE_IDS.map((sampleId) => (
            <button
              key={sampleId}
              type="button"
              disabled={isSubmitting}
              onClick={() => handlePickSample(sampleId)}
              className="h-8 px-2.5 rounded-[6px] bg-[var(--bg-card)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)] text-[12px] font-mono-tabular text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors duration-150 cursor-pointer disabled:opacity-50"
            >
              {sampleId}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
