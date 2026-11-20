import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, LogIn, Send, X } from 'lucide-react';
import type { AuthStatusResponse } from '@mw4trackstats/shared';
import { ApiError, submitFeedback } from '../api/client';
import { useI18n } from '../i18n/I18nContext';

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
  auth: AuthStatusResponse | null;
}

export function FeedbackModal({ open, onClose, auth }: FeedbackModalProps) {
  const { locale, t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open) {
      setErrorText(null);
      setSucceeded(false);
      if (!dialog.open) {
        dialog.showModal();
      }
      window.setTimeout(() => {
        textareaRef.current?.focus();
      }, 40);
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (trimmed.length < 5) {
      setErrorText(t.feedback.minLengthError);
      return;
    }

    setIsSending(true);
    setErrorText(null);
    setSucceeded(false);

    try {
      await submitFeedback(trimmed, locale);
      setMessage('');
      setSucceeded(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrorText(
          err.code === 'RATE_LIMITED'
            ? t.errors.rateLimited
            : err.code === 'USER_X_LOGIN_REQUIRED'
              ? t.feedback.loginRequiredText
              : err.message,
        );
      } else {
        setErrorText(t.errors.generic);
      }
    } finally {
      setIsSending(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className="card-dialog w-full max-w-lg"
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="feedback-dialog-title"
    >
      <div className="px-5 py-4 border-b border-[var(--border-hairline)] flex items-center justify-between gap-4">
        <h2 id="feedback-dialog-title" className="text-[15px] font-medium text-[var(--text-primary)]">
          {t.feedback.modalTitle}
        </h2>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="h-8 px-2.5 rounded-[6px] bg-[var(--bg-raised)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
        >
          <X size={14} strokeWidth={1.5} aria-hidden="true" />
          <span>{t.feedback.closeButton}</span>
        </button>
      </div>

      <div className="p-5">
        {!auth?.authenticated || !auth.user ? (
          <div className="space-y-4">
            <p className="text-[14px] leading-5 text-[var(--text-secondary)]">
              {t.feedback.loginRequiredText}
            </p>
            <a
              href="/api/auth/x/login"
              className="h-10 px-4 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] text-[14px] font-medium inline-flex items-center gap-2 hover:brightness-95 active:scale-[0.98] transition-[filter,transform] duration-150"
            >
              <LogIn size={16} strokeWidth={1.5} aria-hidden="true" />
              <span>{t.auth.signInWithX}</span>
            </a>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--text-muted)]">
              <span>
                {t.feedback.submittingAs}{' '}
                <strong className="font-mono-tabular font-medium text-[var(--text-primary)]">
                  @{auth.user.username}
                </strong>
              </span>
              <span className="font-mono-tabular">{message.length}/1500</span>
            </div>

            <div>
              <label
                htmlFor="feedback-message-input"
                className="block text-[13px] font-medium text-[var(--text-primary)] mb-1.5"
              >
                {t.feedback.textareaLabel}
              </label>
              <textarea
                ref={textareaRef}
                id="feedback-message-input"
                rows={5}
                minLength={5}
                maxLength={1500}
                required
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  if (succeeded) setSucceeded(false);
                }}
                placeholder={t.feedback.textareaPlaceholder}
                className="lookup-input w-full p-3 rounded-[8px] text-[14px] leading-5 resize-y placeholder:text-[var(--text-muted)]"
              />
            </div>

            {succeeded ? (
              <p className="text-[13px] text-[var(--positive)] flex items-center gap-2">
                <Check size={16} strokeWidth={1.5} aria-hidden="true" />
                <span>{t.feedback.successMessage}</span>
              </p>
            ) : null}

            {errorText ? (
              <p className="text-[13px] text-[var(--negative)]">{errorText}</p>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <button
                type="submit"
                disabled={isSending}
                className="h-10 px-4 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] text-[14px] font-medium inline-flex items-center gap-2 hover:brightness-95 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-[filter,transform] duration-150 cursor-pointer"
              >
                <Send size={15} strokeWidth={1.5} aria-hidden="true" />
                <span>{isSending ? t.feedback.submittingButton : t.feedback.submitButton}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
