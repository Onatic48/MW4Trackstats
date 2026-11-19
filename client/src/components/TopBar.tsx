import { Crosshair, Globe, LogIn, LogOut } from 'lucide-react';
import type { AuthStatusResponse } from '@mw4trackstats/shared';
import { useI18n } from '../i18n/I18nContext';
import { SUPPORTED_LOCALES } from '../i18n/types';

interface TopBarProps {
  auth: AuthStatusResponse | null;
  onLogout: () => void;
}

export function TopBar({ auth, onLogout }: TopBarProps) {
  const { locale, setLocale, t } = useI18n();

  return (
    <header className="h-14 bg-[var(--bg-deep)] border-b border-[var(--border-hairline)]">
      <div className="max-w-[1440px] h-full mx-auto px-6 md:px-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-4 h-4 flex items-center justify-center shrink-0">
            <Crosshair size={16} strokeWidth={1.5} className="text-[var(--text-secondary)]" aria-hidden="true" />
          </div>
          <span className="text-[16px] leading-none font-semibold text-[var(--text-primary)] tracking-normal">
            {t.brand.name}
          </span>
          <span
            aria-hidden="true"
            className="hidden sm:inline-block h-4 w-px bg-[var(--border-strong)]"
          />
          <span className="hidden sm:inline text-[13px] text-[var(--text-muted)] truncate">
            {t.brand.subtitle}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {auth?.authenticated && auth.user ? (
            <div className="inline-flex items-center gap-2 h-9 px-2.5 rounded-[8px] bg-[var(--bg-card)] border border-[var(--border-hairline)] text-[12px]">
              <span className="w-2 h-2 rounded-full bg-[var(--positive)] shrink-0" aria-hidden="true" />
              <span className="font-mono-tabular text-[var(--text-primary)]">
                @{auth.user.username}
              </span>
              <button
                type="button"
                onClick={onLogout}
                title={t.auth.signOut}
                className="h-6 px-1.5 rounded-[4px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-raised)] inline-flex items-center gap-1 transition-colors duration-150 cursor-pointer"
              >
                <LogOut size={14} strokeWidth={1.5} aria-hidden="true" />
                <span className="hidden sm:inline">{t.auth.signOut}</span>
              </button>
            </div>
          ) : auth?.oauthConfigured ? (
            <a
              href="/api/auth/x/login"
              className="h-9 px-3 rounded-[8px] bg-[var(--bg-raised)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] inline-flex items-center gap-2 transition-colors duration-150"
            >
              <LogIn size={16} strokeWidth={1.5} className="text-[var(--text-secondary)]" aria-hidden="true" />
              <span>{t.auth.signInWithX}</span>
            </a>
          ) : null}

          <div
            role="group"
            aria-label={t.topBar.languageLabel}
            className="inline-flex items-center gap-1 p-1 rounded-[8px] bg-[var(--bg-card)] border border-[var(--border-hairline)]"
          >
            <span className="w-4 h-4 ml-1 flex items-center justify-center text-[var(--text-muted)]">
              <Globe size={16} strokeWidth={1.5} aria-hidden="true" />
            </span>
            {SUPPORTED_LOCALES.map((item) => {
              const active = locale === item.code;
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => setLocale(item.code)}
                  aria-pressed={active}
                  className={[
                    'h-7 px-2 rounded-[6px] text-[12px] font-mono-tabular font-medium transition-colors duration-150 cursor-pointer',
                    active
                      ? 'bg-[var(--bg-raised)] text-[var(--text-primary)] border border-[var(--border-strong)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-transparent',
                  ].join(' ')}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}
