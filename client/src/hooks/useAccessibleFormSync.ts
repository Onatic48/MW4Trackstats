import { useEffect, type RefObject } from 'react';

function ensureLiveAnnouncer(): HTMLElement {
  const existing = document.getElementById('mw4-form-live-announcer');
  if (existing) {
    return existing;
  }
  const el = document.createElement('div');
  el.id = 'mw4-form-live-announcer';
  el.setAttribute('aria-live', 'polite');
  el.className = 'visually-hidden';
  document.body.append(el);
  return el;
}

function linkErrorToDescribedBy(input: HTMLInputElement, shown: boolean): void {
  const errorId = input.dataset.error;
  if (!errorId) {
    return;
  }
  const ids = (input.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter((id) => id && id !== errorId);
  if (shown) {
    ids.push(errorId);
  }
  if (ids.length > 0) {
    input.setAttribute('aria-describedby', ids.join(' '));
  } else {
    input.removeAttribute('aria-describedby');
  }
}

export function useAccessibleFormSync(
  inputRef: RefObject<HTMLInputElement | null>,
  serverInvalid: boolean,
): void {
  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    const announcer = ensureLiveAnnouncer();
    const supportsNativeUserInvalid = CSS.supports('selector(:user-invalid)');
    let hasInteracted = false;
    let hasBlurred = false;
    let wasAnnounced = false;
    let announceTimer: number | undefined;

    input.setAttribute('aria-invalid', 'false');

    const announceError = () => {
      const errorId = input.dataset.error;
      if (!errorId) {
        return;
      }
      const errorEl = document.getElementById(errorId);
      if (!errorEl) {
        return;
      }
      const messageText = errorEl.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (!messageText) {
        return;
      }
      window.clearTimeout(announceTimer);
      announcer.textContent = '';
      announceTimer = window.setTimeout(() => {
        announcer.textContent = messageText;
      }, 450);
    };

    const syncAria = (shouldAnnounce: boolean) => {
      const nativeUserInvalid = supportsNativeUserInvalid
        ? input.matches(':user-invalid')
        : (hasInteracted && hasBlurred && !input.validity.valid);

      if (!supportsNativeUserInvalid && hasInteracted && hasBlurred) {
        input.classList.toggle('user-invalid-fallback', !input.validity.valid);
      }

      const isInvalid = nativeUserInvalid || serverInvalid;

      if (isInvalid) {
        input.setAttribute('aria-invalid', 'true');
        linkErrorToDescribedBy(input, true);
        if (shouldAnnounce && !wasAnnounced) {
          announceError();
          wasAnnounced = true;
        }
      } else {
        input.setAttribute('aria-invalid', 'false');
        linkErrorToDescribedBy(input, false);
        wasAnnounced = false;
        window.clearTimeout(announceTimer);
        announcer.textContent = '';
      }
    };

    syncAria(false);

    const onBlur = () => {
      hasBlurred = true;
      syncAria(true);
    };

    const onInput = () => {
      hasInteracted = true;
      input.removeAttribute('data-server-invalid');
      syncAria(false);
    };

    const onInvalid = () => {
      hasInteracted = true;
      hasBlurred = true;
      wasAnnounced = true;
      syncAria(false);
    };

    input.addEventListener('blur', onBlur);
    input.addEventListener('input', onInput);
    input.addEventListener('invalid', onInvalid);

    return () => {
      window.clearTimeout(announceTimer);
      input.removeEventListener('blur', onBlur);
      input.removeEventListener('input', onInput);
      input.removeEventListener('invalid', onInvalid);
    };
  }, [inputRef, serverInvalid]);
}
