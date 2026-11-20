import { Crosshair, Globe, LogIn, LogOut, MessageSquare } from 'lucide-react';
import type { AuthStatusResponse } from '@mw4trackstats/shared';
import { useI18n } from '../i18n/I18nContext';
import { SUPPORTED_LOCALES } from '../i18n/types';

const GITHUB_REPO_URL = 'https://github.com/Onatic48/MW4Trackstats';

interface TopBarProps {
  auth: AuthStatusResponse | null;
  onLogout: () => void;
  onOpenFeedback: () => void;
}

export function TopBar({ auth, onLogout, onOpenFeedback }: TopBarProps) {
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

          <button
            type="button"
            onClick={onOpenFeedback}
            aria-label={t.feedback.buttonLabel}
            title={t.feedback.buttonLabel}
            className="h-9 px-2.5 sm:px-3 rounded-[8px] bg-[var(--bg-card)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)] text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-2 transition-colors duration-150 cursor-pointer"
          >
            <MessageSquare size={15} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
            <span className="hidden md:inline">{t.feedback.buttonLabel}</span>
          </button>

          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.topBar.githubLabel}
            title={t.topBar.githubLabel}
            className="h-9 px-2.5 sm:px-3 rounded-[8px] bg-[var(--bg-card)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-raised)] text-[13px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-2 transition-colors duration-150"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="currentColor"
              aria-hidden="true"
              className="shrink-0"
            >
              <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
            </svg>
            <span className="hidden sm:inline">GitHub</span>
          </a>
        </div>
      </div>
    </header>
  );
}
