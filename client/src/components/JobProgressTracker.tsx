import { Check, Circle, CircleDot, Clock } from 'lucide-react';
import type { ActiveJobView } from '../hooks/useStatsLookup';
import { useI18n } from '../i18n/I18nContext';

interface JobProgressTrackerProps {
  job: ActiveJobView;
}

const STEP_INDEX: Record<ActiveJobView['step'], number> = {
  queued: 1,
  posting_tweet: 1,
  waiting_bot_reply: 2,
  downloading_image: 3,
  parsing_image: 3,
  completed: 4,
  failed: 4,
};

export function JobProgressTracker({ job }: JobProgressTrackerProps) {
  const { t } = useI18n();
  const currentIdx = STEP_INDEX[job.step] ?? 1;

  const steps = [
    { id: 'cache', label: t.progress.steps.cache },
    { id: 'posting', label: t.progress.steps.posting },
    { id: 'waiting', label: t.progress.steps.waiting },
    { id: 'parsing', label: t.progress.steps.parsing },
  ];

  return (
    <section
      aria-live="polite"
      className="panel-enter mt-6 p-5 rounded-[12px] bg-[var(--bg-card)] border border-[var(--border-hairline)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[var(--border-hairline)]">
        <div>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="w-2 h-2 rounded-full bg-[var(--accent)]"
            />
            <h2 className="text-[15px] font-medium text-[var(--text-primary)]">
              {t.progress.activeTitle}
            </h2>
            <span className="text-[13px] font-mono-tabular text-[var(--text-secondary)]">
              {job.activisionId}
            </span>
          </div>
          {job.deduplicated ? (
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              {t.progress.deduplicatedNotice}
            </p>
          ) : null}
          {job.staleData ? (
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              {t.progress.staleShowingNotice}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-4 text-[12px] font-mono-tabular text-[var(--text-secondary)]">
          <span>
            {t.progress.queuePositionLabel}: {Math.max(1, job.queuePosition)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Clock size={16} strokeWidth={1.5} className="text-[var(--text-muted)]" aria-hidden="true" />
            <span>
              {t.progress.elapsedLabel}: {job.elapsedSeconds}s
            </span>
          </span>
        </div>
      </div>

      <ol className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 list-none p-0 m-0">
        {steps.map((step, index) => {
          const isDone = index < currentIdx;
          const isActive = index === currentIdx;

          return (
            <li
              key={step.id}
              className={[
                'p-3 rounded-[8px] border flex items-center gap-2.5 transition-colors duration-150',
                isActive
                  ? 'bg-[var(--bg-raised)] border-[var(--border-strong)]'
                  : 'bg-[var(--bg-page)] border-[var(--border-hairline)]',
              ].join(' ')}
            >
              <span className="w-4 h-4 flex items-center justify-center shrink-0">
                {isDone ? (
                  <Check size={16} strokeWidth={1.5} className="text-[var(--positive)]" aria-hidden="true" />
                ) : isActive ? (
                  <CircleDot size={16} strokeWidth={1.5} className="text-[var(--accent)]" aria-hidden="true" />
                ) : (
                  <Circle size={16} strokeWidth={1.5} className="text-[var(--text-muted)]" aria-hidden="true" />
                )}
              </span>
              <span
                className={[
                  'text-[13px] leading-5',
                  isDone || isActive
                    ? 'text-[var(--text-primary)] font-medium'
                    : 'text-[var(--text-muted)]',
                ].join(' ')}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
