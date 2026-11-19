import { AlertTriangle, LogIn } from 'lucide-react';
import type { JobErrorInfo } from '@mw4trackstats/shared';
import { JobProgressTracker } from './components/JobProgressTracker';
import { LegalFooter } from './components/LegalFooter';
import { RecentLookups } from './components/RecentLookups';
import { SearchPanel } from './components/SearchPanel';
import { StatsDashboard } from './components/StatsDashboard';
import { TopBar } from './components/TopBar';
import { useStatsLookup } from './hooks/useStatsLookup';
import { I18nProvider, useI18n } from './i18n/I18nContext';

function resolveErrorMessage(
  error: JobErrorInfo,
  t: ReturnType<typeof useI18n>['t'],
): string {
  switch (error.code) {
    case 'INVALID_ID':
      return t.search.invalidError;
    case 'RATE_LIMITED':
      return t.errors.rateLimited;
    case 'X_RATE_LIMITED':
      return t.errors.xRateLimited;
    case 'X_CHALLENGE_REQUIRED':
      return t.errors.xChallenge;
    case 'X_AUTH_REQUIRED':
      return t.errors.xAuth;
    case 'BOT_TIMEOUT':
      return t.errors.botTimeout;
    case 'BOT_NO_STATS':
      return t.errors.botNoStats;
    case 'PARSE_FAILED':
      return t.errors.parseFailed;
    default:
      return error.message || t.errors.generic;
  }
}

function TrackerWorkspace() {
  const { t } = useI18n();
  const {
    auth,
    recent,
    stats,
    source,
    activeJob,
    error,
    pendingLoginId,
    authNotice,
    isSubmitting,
    submitLookup,
    handleLogout,
    handleRecordPurged,
  } = useStatsLookup();

  const inlineValidationError =
    error?.code === 'INVALID_ID' ? resolveErrorMessage(error, t) : null;
  const operationError =
    error && error.code !== 'INVALID_ID' ? resolveErrorMessage(error, t) : null;

  const authNoticeText =
    authNotice === 'denied'
      ? t.auth.authDeniedError
      : authNotice === 'expired' || authNotice === 'invalid_state' || authNotice === 'exchange_failed'
        ? t.auth.authExpiredError
        : null;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-page)] text-[var(--text-primary)]">
      <TopBar auth={auth} onLogout={() => void handleLogout()} />

      <main className="flex-1 w-full max-w-[1440px] mx-auto px-6 md:px-8">
        <SearchPanel
          isSubmitting={isSubmitting}
          serverError={inlineValidationError}
          onSubmit={(id) => void submitLookup(id, false)}
        />

        {authNoticeText ? (
          <section
            role="alert"
            className="panel-enter mt-6 p-4 rounded-[12px] bg-[var(--bg-card)] border border-[var(--border-hairline)] flex items-center gap-3"
          >
            <AlertTriangle
              size={16}
              strokeWidth={1.5}
              className="text-[var(--accent)] shrink-0"
              aria-hidden="true"
            />
            <p className="text-[14px] text-[var(--text-secondary)]">{authNoticeText}</p>
          </section>
        ) : null}

        {pendingLoginId ? (
          <section className="panel-enter mt-6 p-5 rounded-[12px] bg-[var(--bg-card)] border border-[var(--border-hairline)] flex flex-wrap items-center justify-between gap-4">
            <div className="max-w-2xl">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-medium text-[var(--text-primary)]">
                  {t.auth.loginRequiredTitle}
                </h2>
                <span className="text-[13px] font-mono-tabular text-[var(--text-secondary)]">
                  {pendingLoginId}
                </span>
              </div>
              <p className="mt-1.5 text-[14px] text-[var(--text-secondary)]">
                {t.auth.loginRequiredBody}
              </p>
            </div>
            <a
              href={`/api/auth/x/login?returnId=${encodeURIComponent(pendingLoginId)}`}
              className="h-10 px-4 rounded-[8px] bg-[var(--accent)] text-[var(--accent-ink)] text-[14px] font-medium inline-flex items-center gap-2 hover:brightness-95 active:scale-[0.98] transition-[filter,transform] duration-150 shrink-0"
            >
              <LogIn size={16} strokeWidth={1.5} aria-hidden="true" />
              <span>{t.auth.signInWithX}</span>
            </a>
          </section>
        ) : null}

        {activeJob ? <JobProgressTracker job={activeJob} /> : null}

        {operationError ? (
          <section
            role="alert"
            className="panel-enter mt-6 p-5 rounded-[12px] bg-[var(--bg-card)] border border-[var(--border-hairline)] flex flex-wrap items-start justify-between gap-4"
          >
            <div className="flex items-start gap-3">
              <span className="w-4 h-4 mt-0.5 flex items-center justify-center shrink-0">
                <AlertTriangle
                  size={16}
                  strokeWidth={1.5}
                  className="text-[var(--negative)]"
                  aria-hidden="true"
                />
              </span>
              <div>
                <h2 className="text-[15px] font-medium text-[var(--text-primary)]">
                  {t.errors.heading}
                </h2>
                <p className="mt-1 text-[14px] text-[var(--text-secondary)]">
                  {operationError}
                </p>
                {error?.message && error.message !== operationError ? (
                  <p className="mt-1 text-[12px] font-mono-tabular text-[var(--text-muted)]">
                    {error.message}
                  </p>
                ) : null}
                {stats && source === 'stale' ? (
                  <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                    {t.errors.fallbackBanner}
                  </p>
                ) : null}
              </div>
            </div>
            {stats ? (
              <button
                type="button"
                onClick={() => void submitLookup(stats.activisionId, true)}
                className="h-9 px-3.5 rounded-[8px] bg-[var(--bg-raised)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] cursor-pointer"
              >
                {t.errors.retryButton}
              </button>
            ) : null}
          </section>
        ) : null}

        {stats ? (
          <StatsDashboard
            stats={stats}
            source={source}
            isRefreshing={isSubmitting}
            onRefresh={() => void submitLookup(stats.activisionId, true)}
          />
        ) : null}

        <RecentLookups
          items={recent}
          onSelect={(id) => void submitLookup(id, false)}
        />
      </main>

      <LegalFooter onPurged={handleRecordPurged} />
    </div>
  );
}

export function App() {
  return (
    <I18nProvider>
      <TrackerWorkspace />
    </I18nProvider>
  );
}

export default App;
