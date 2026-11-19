import type { RecentPlayerSummary } from '@mw4trackstats/shared';
import { useI18n } from '../i18n/I18nContext';

interface RecentLookupsProps {
  items: RecentPlayerSummary[];
  onSelect: (activisionId: string) => void;
}

export function RecentLookups({ items, onSelect }: RecentLookupsProps) {
  const { t, formatNumber, formatRelativeTime } = useI18n();

  return (
    <section className="mt-10 pb-12">
      <div className="p-6 rounded-[12px] bg-[var(--bg-card)] border border-[var(--border-hairline)]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b border-[var(--border-hairline)]">
          <div>
            <h2 className="text-[16px] font-medium text-[var(--text-primary)]">
              {t.recent.title}
            </h2>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              {t.recent.subtitle}
            </p>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="mt-4 text-[14px] text-[var(--text-muted)]">{t.recent.empty}</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="text-[12px] text-[var(--text-muted)] border-b border-[var(--border-hairline)]">
                  <th className="py-2.5 pr-4 font-normal">{t.recent.colPlayer}</th>
                  <th className="py-2.5 px-3 font-normal text-right">{t.recent.colMpKd}</th>
                  <th className="py-2.5 px-3 font-normal text-right">{t.recent.colResKills}</th>
                  <th className="py-2.5 px-3 font-normal text-right">{t.recent.colDmzExfils}</th>
                  <th className="py-2.5 pl-3 font-normal text-right">{t.recent.colFreshness}</th>
                </tr>
              </thead>
              <tbody className="text-[14px] font-mono-tabular divide-y divide-[var(--border-hairline)]">
                {items.map((item) => (
                  <tr
                    key={item.normalizedId}
                    className="h-10 hover:bg-[var(--bg-raised)] transition-colors duration-150"
                  >
                    <td className="py-2 pr-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onSelect(item.activisionId)}
                        className="text-left text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors duration-150 cursor-pointer font-medium"
                      >
                        {item.activisionId}
                      </button>
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap text-[var(--text-secondary)]">
                      {formatNumber(item.multiplayerKd, 2)}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap text-[var(--text-secondary)]">
                      {formatNumber(item.resurgenceKills)}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap text-[var(--text-secondary)]">
                      {formatNumber(item.dmzExfils)}
                    </td>
                    <td className="py-2 pl-3 text-right whitespace-nowrap text-[12px]">
                      <span
                        className={
                          item.isFresh
                            ? 'text-[var(--positive)]'
                            : 'text-[var(--text-muted)]'
                        }
                      >
                        {item.isFresh ? t.recent.freshBadge : t.recent.expiredBadge}
                      </span>
                      <span className="text-[var(--text-muted)] ml-2">
                        {formatRelativeTime(item.fetchedAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
