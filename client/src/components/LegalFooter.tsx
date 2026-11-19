import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Shield, Trash2, X } from 'lucide-react';
import { ApiError, purgePlayerStats } from '../api/client';
import { useI18n } from '../i18n/I18nContext';

interface LegalFooterProps {
  onPurged: (activisionId: string) => void;
}

export function LegalFooter({ onPurged }: LegalFooterProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const removalInputRef = useRef<HTMLInputElement | null>(null);

  const [removalId, setRemovalId] = useState('');
  const [isRemoving, setIsRemoving] = useState(false);
  const [removalResult, setRemovalResult] = useState<{
    deleted: boolean;
    activisionId: string;
  } | null>(null);
  const [removalError, setRemovalError] = useState<string | null>(null);

  // Safari / legacy fallback for dialog closedby="any" light-dismiss
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) {
      return;
    }
    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      );
    };
    let pressedOutside = false;
    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        dialog.close();
      }
      pressedOutside = false;
    };
    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  const openModal = (focusRemoval = false) => {
    setRemovalResult(null);
    setRemovalError(null);
    dialogRef.current?.showModal();
    if (focusRemoval) {
      window.setTimeout(() => {
        removalInputRef.current?.focus();
      }, 50);
    }
  };

  const handleRemovalSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = removalId.trim();
    if (!trimmed) {
      return;
    }

    setIsRemoving(true);
    setRemovalResult(null);
    setRemovalError(null);

    try {
      const res = await purgePlayerStats(trimmed);
      setRemovalResult(res);
      setRemovalId('');
      onPurged(res.activisionId);
    } catch (err) {
      if (err instanceof ApiError) {
        setRemovalError(
          err.code === 'INVALID_ID'
            ? t.search.invalidError
            : err.code === 'RATE_LIMITED'
              ? t.errors.rateLimited
              : err.message,
        );
      } else {
        setRemovalError(t.errors.generic);
      }
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <footer className="mt-16 border-t border-[var(--border-hairline)] bg-[var(--bg-deep)]">
      <div className="max-w-[1440px] mx-auto px-6 md:px-8 py-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
        <div className="max-w-3xl space-y-1.5">
          <p className="text-[12px] leading-5 text-[var(--text-secondary)]">
            {t.legal.footerDisclaimer}
          </p>
          <p className="text-[11px] leading-4 text-[var(--text-muted)]">
            {t.legal.trademarkNotice}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => openModal(false)}
            className="h-8 px-3 rounded-[6px] bg-[var(--bg-card)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer"
          >
            <Shield size={14} strokeWidth={1.5} aria-hidden="true" />
            <span>{t.legal.termsButton}</span>
          </button>

          <button
            type="button"
            onClick={() => openModal(false)}
            className="h-8 px-3 rounded-[6px] bg-[var(--bg-card)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors duration-150 cursor-pointer"
          >
            {t.legal.privacyButton}
          </button>

          <button
            type="button"
            onClick={() => openModal(true)}
            className="h-8 px-3 rounded-[6px] bg-[var(--bg-card)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5 transition-colors duration-150 cursor-pointer"
          >
            <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
            <span>{t.legal.removeDataButton}</span>
          </button>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        closedby="any"
        aria-label={t.legal.modalTitle}
        className="card-modal w-full max-w-2xl rounded-[12px] bg-[var(--bg-card)] border border-[var(--border-strong)] text-[var(--text-primary)] p-0 m-auto"
      >
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-[var(--border-hairline)]">
          <h2 className="text-[15px] font-medium text-[var(--text-primary)]">
            {t.legal.modalTitle}
          </h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="h-8 px-2.5 rounded-[6px] bg-[var(--bg-raised)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
            <span>{t.legal.closeButton}</span>
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[78vh] overflow-y-auto text-[13px] leading-5 text-[var(--text-secondary)]">
          <section className="space-y-1.5">
            <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
              {t.legal.termsHeading}
            </h3>
            <p>{t.legal.termsBody}</p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
              {t.legal.xAutomationHeading}
            </h3>
            <p>{t.legal.xAutomationBody}</p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
              {t.legal.privacyHeading}
            </h3>
            <p>{t.legal.privacyBody}</p>
          </section>

          <section className="space-y-1.5">
            <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
              {t.legal.cookiesHeading}
            </h3>
            <p>{t.legal.cookiesBody}</p>
          </section>

          <section className="pt-4 border-t border-[var(--border-hairline)] space-y-3">
            <h3 className="text-[14px] font-medium text-[var(--text-primary)]">
              {t.legal.removalHeading}
            </h3>
            <p>{t.legal.removalDescription}</p>

            <form onSubmit={(e) => void handleRemovalSubmit(e)} className="flex flex-col sm:flex-row gap-2.5">
              <input
                ref={removalInputRef}
                type="text"
                value={removalId}
                onChange={(e) => setRemovalId(e.target.value)}
                required
                pattern="[^\s#]{1,32}#\d{4,10}"
                maxLength={43}
                placeholder={t.legal.removalInputPlaceholder}
                className="lookup-input flex-1 h-9 px-3 rounded-[8px] font-mono-tabular text-[13px] placeholder:text-[var(--text-muted)]"
              />
              <button
                type="submit"
                disabled={isRemoving}
                className="h-9 px-3.5 rounded-[8px] bg-[var(--bg-raised)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] inline-flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer shrink-0"
              >
                <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
                <span>
                  {isRemoving ? t.legal.removalSubmittingButton : t.legal.removalSubmitButton}
                </span>
              </button>
            </form>

            {removalResult ? (
              <p className="text-[12px] text-[var(--positive)] flex items-center gap-1.5">
                <Check size={14} strokeWidth={1.5} aria-hidden="true" />
                <span>
                  {removalResult.deleted
                    ? t.legal.removalSuccessFound
                    : t.legal.removalSuccessNotFound}{' '}
                  <strong className="font-mono-tabular">{removalResult.activisionId}</strong>
                </span>
              </p>
            ) : null}

            {removalError ? (
              <p className="text-[12px] text-[var(--negative)]">{removalError}</p>
            ) : null}
          </section>
        </div>
      </dialog>
    </footer>
  );
}
