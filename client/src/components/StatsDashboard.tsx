import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Copy, Maximize2, RefreshCw, X } from 'lucide-react';
import type { CombatRecordStats, GameModeKey } from '@mw4trackstats/shared';
import type { StatsSourceKind } from '../hooks/useStatsLookup';
import { useI18n } from '../i18n/I18nContext';

type TabKey = 'overview' | GameModeKey;

const TAB_KEYS: readonly TabKey[] = [
  'overview',
  'multiplayer',
  'dmz',
  'battleRoyale',
  'resurgence',
];

const MODE_ORDER: readonly GameModeKey[] = [
  'multiplayer',
  'dmz',
  'battleRoyale',
  'resurgence',
];

interface StatsDashboardProps {
  stats: CombatRecordStats;
  source: StatsSourceKind;
  isRefreshing: boolean;
  onRefresh: () => void;
}

interface StatCardItem {
  label: string;
  value: string;
  isNull: boolean;
}

export function StatsDashboard({
  stats,
  source,
  isRefreshing,
  onRefresh,
}: StatsDashboardProps) {
  const { t, formatNumber, formatDurationMinutes, formatRelativeTime } = useI18n();
  const [selectedTab, setSelectedTab] = useState<TabKey>('overview');
  const [copied, setCopied] = useState(false);

  const tabRefs = useRef<Record<TabKey, HTMLButtonElement | null>>({
    overview: null,
    multiplayer: null,
    dmz: null,
    battleRoyale: null,
    resurgence: null,
  });

  const panelRefs = useRef<Record<TabKey, HTMLDivElement | null>>({
    overview: null,
    multiplayer: null,
    dmz: null,
    battleRoyale: null,
    resurgence: null,
  });

  const tablistRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  // Auto-open the sole played mode tab when the player only has one populated mode
  useEffect(() => {
    const playedModes = MODE_ORDER.filter((m) => {
      const modeStats = stats.modes[m];
      if (modeStats.timePlayedMinutes !== null) {
        return true;
      }
      if ('kills' in modeStats && modeStats.kills !== null) {
        return true;
      }
      if ('hostileEliminations' in modeStats && modeStats.hostileEliminations !== null) {
        return true;
      }
      return false;
    });

    if (playedModes.length === 1 && playedModes[0]) {
      setSelectedTab(playedModes[0]);
    } else {
      setSelectedTab('overview');
    }
  }, [stats.normalizedId, stats.fetchedAt, stats.modes]);

  // Edge fade fallback via IntersectionObserver when scroll-driven animations are unavailable
  useEffect(() => {
    const tablist = tablistRef.current;
    if (!tablist || CSS.supports('animation-timeline', 'scroll()')) {
      return;
    }
    const first = tablist.firstElementChild;
    const last = tablist.lastElementChild;
    if (!first || !last) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const { target, intersectionRatio } of entries) {
          tablist.classList.toggle(
            target === first ? 'more-start' : 'more-end',
            intersectionRatio < 1,
          );
        }
      },
      { root: tablist, threshold: 1, rootMargin: '1px' },
    );
    observer.observe(first);
    observer.observe(last);
    return () => observer.disconnect();
  }, []);

  // Sync hidden="until-found" and beforematch across tab panels cleanly
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    for (const key of TAB_KEYS) {
      const panel = panelRefs.current[key];
      if (!panel) {
        continue;
      }
      if (key === selectedTab) {
        panel.removeAttribute('hidden');
      } else {
        panel.setAttribute('hidden', 'until-found');
      }

      const handleBeforeMatch = () => {
        setSelectedTab(key);
      };
      panel.addEventListener('beforematch', handleBeforeMatch);
      cleanups.push(() => panel.removeEventListener('beforematch', handleBeforeMatch));
    }
    return () => {
      for (const fn of cleanups) {
        fn();
      }
    };
  }, [selectedTab]);

  // Mandatory Safari/legacy fallback for dialog closedby="any" light-dismiss
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

  const handleCopyLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set('id', stats.activisionId);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable in restricted contexts
    }
  };

  const selectTab = (next: TabKey, focusTab = false) => {
    setSelectedTab(next);
    const btn = tabRefs.current[next];
    if (btn) {
      btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (focusTab) {
        btn.focus();
      }
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const idx = TAB_KEYS.indexOf(selectedTab);
    if (idx < 0) {
      return;
    }
    let nextIdx: number | null = null;
    if (event.key === 'ArrowRight') {
      nextIdx = (idx + 1) % TAB_KEYS.length;
    } else if (event.key === 'ArrowLeft') {
      nextIdx = (idx - 1 + TAB_KEYS.length) % TAB_KEYS.length;
    } else if (event.key === 'Home') {
      nextIdx = 0;
    } else if (event.key === 'End') {
      nextIdx = TAB_KEYS.length - 1;
    }

    if (nextIdx !== null) {
      const nextKey = TAB_KEYS[nextIdx];
      if (nextKey) {
        event.preventDefault();
        selectTab(nextKey, true);
      }
    }
  };

  const cardsByTab = useMemo((): Record<TabKey, StatCardItem[]> => {
    const { multiplayer, dmz, battleRoyale, resurgence } = stats.modes;

    const totalMinutes = [
      multiplayer.timePlayedMinutes,
      dmz.timePlayedMinutes,
      battleRoyale.timePlayedMinutes,
      resurgence.timePlayedMinutes,
    ].reduce<number>((sum, val) => sum + (val ?? 0), 0);

    const anyMinutes = [
      multiplayer.timePlayedMinutes,
      dmz.timePlayedMinutes,
      battleRoyale.timePlayedMinutes,
      resurgence.timePlayedMinutes,
    ].some((v) => v !== null);

    const totalPlayerKills = [
      multiplayer.kills,
      dmz.playerEliminations,
      battleRoyale.kills,
      resurgence.kills,
    ].reduce<number>((sum, val) => sum + (val ?? 0), 0);

    const kdValues = [multiplayer.kdRatio, battleRoyale.kdRatio, resurgence.kdRatio].filter(
      (v): v is number => v !== null,
    );
    const bestKd = kdValues.length > 0 ? Math.max(...kdValues) : null;

    const totalWinsAndExfils =
      (multiplayer.wins ?? 0) +
      (dmz.successfulExfils ?? 0) +
      (battleRoyale.wins ?? 0) +
      (resurgence.wins ?? 0);

    const activeModesCount = MODE_ORDER.filter(
      (m) => stats.modes[m].timePlayedMinutes !== null,
    ).length;

    return {
      overview: [
        {
          label: t.dashboard.metrics.timePlayed,
          value: anyMinutes ? formatDurationMinutes(totalMinutes) : '--',
          isNull: !anyMinutes,
        },
        {
          label: t.dashboard.metrics.kills,
          value: formatNumber(totalPlayerKills),
          isNull: false,
        },
        {
          label: t.dashboard.metrics.kdRatio,
          value: bestKd !== null ? formatNumber(bestKd, 2) : '--',
          isNull: bestKd === null,
        },
        {
          label: `${t.dashboard.metrics.wins} / ${t.dashboard.summaryTable.exfilsLabel}`,
          value: formatNumber(totalWinsAndExfils),
          isNull: false,
        },
        {
          label: t.dashboard.summaryTable.colMode,
          value: `${activeModesCount} / 4`,
          isNull: false,
        },
      ],
      multiplayer: [
        {
          label: t.dashboard.metrics.timePlayed,
          value: formatDurationMinutes(multiplayer.timePlayedMinutes),
          isNull: multiplayer.timePlayedMinutes === null,
        },
        {
          label: t.dashboard.metrics.kills,
          value: formatNumber(multiplayer.kills),
          isNull: multiplayer.kills === null,
        },
        {
          label: t.dashboard.metrics.kdRatio,
          value: formatNumber(multiplayer.kdRatio, 2),
          isNull: multiplayer.kdRatio === null,
        },
        {
          label: t.dashboard.metrics.highestStreak,
          value: formatNumber(multiplayer.highestStreak),
          isNull: multiplayer.highestStreak === null,
        },
        {
          label: t.dashboard.metrics.wins,
          value: formatNumber(multiplayer.wins),
          isNull: multiplayer.wins === null,
        },
        ...(multiplayer.gamesPlayed !== null && multiplayer.gamesPlayed !== undefined
          ? [
              {
                label: t.dashboard.metrics.gamesPlayed,
                value: formatNumber(multiplayer.gamesPlayed),
                isNull: false,
              },
            ]
          : []),
        ...(multiplayer.winLossRatio !== null && multiplayer.winLossRatio !== undefined
          ? [
              {
                label: t.dashboard.metrics.winLossRatio,
                value: formatNumber(multiplayer.winLossRatio, 2),
                isNull: false,
              },
            ]
          : []),
        ...(multiplayer.accuracyPercent !== null && multiplayer.accuracyPercent !== undefined
          ? [
              {
                label: t.dashboard.metrics.accuracy,
                value: `${formatNumber(multiplayer.accuracyPercent, 2)}%`,
                isNull: false,
              },
            ]
          : []),
      ],
      dmz: [
        {
          label: t.dashboard.metrics.timePlayed,
          value: formatDurationMinutes(dmz.timePlayedMinutes),
          isNull: dmz.timePlayedMinutes === null,
        },
        {
          label: t.dashboard.metrics.playerEliminations,
          value: formatNumber(dmz.playerEliminations),
          isNull: dmz.playerEliminations === null,
        },
        {
          label: t.dashboard.metrics.hostileEliminations,
          value: formatNumber(dmz.hostileEliminations),
          isNull: dmz.hostileEliminations === null,
        },
        {
          label: t.dashboard.metrics.containersOpened,
          value: formatNumber(dmz.containersOpened),
          isNull: dmz.containersOpened === null,
        },
        {
          label: t.dashboard.metrics.successfulExfils,
          value: formatNumber(dmz.successfulExfils),
          isNull: dmz.successfulExfils === null,
        },
        ...(dmz.dynamicOps !== null && dmz.dynamicOps !== undefined
          ? [
              {
                label: t.dashboard.metrics.dynamicOps,
                value: formatNumber(dmz.dynamicOps),
                isNull: false,
              },
            ]
          : []),
        ...(dmz.gamesPlayed !== null && dmz.gamesPlayed !== undefined
          ? [
              {
                label: t.dashboard.metrics.gamesPlayed,
                value: formatNumber(dmz.gamesPlayed),
                isNull: false,
              },
            ]
          : []),
        ...(dmz.medicalItems !== null && dmz.medicalItems !== undefined
          ? [
              {
                label: t.dashboard.metrics.medicalItems,
                value: formatNumber(dmz.medicalItems),
                isNull: false,
              },
            ]
          : []),
      ],
      battleRoyale: [
        {
          label: t.dashboard.metrics.timePlayed,
          value: formatDurationMinutes(battleRoyale.timePlayedMinutes),
          isNull: battleRoyale.timePlayedMinutes === null,
        },
        {
          label: t.dashboard.metrics.kills,
          value: formatNumber(battleRoyale.kills),
          isNull: battleRoyale.kills === null,
        },
        {
          label: t.dashboard.metrics.kdRatio,
          value: formatNumber(battleRoyale.kdRatio, 2),
          isNull: battleRoyale.kdRatio === null,
        },
        {
          label: t.dashboard.metrics.highestKillsPerGame,
          value: formatNumber(battleRoyale.highestKillsPerGame),
          isNull: battleRoyale.highestKillsPerGame === null,
        },
        {
          label: t.dashboard.metrics.wins,
          value: formatNumber(battleRoyale.wins),
          isNull: battleRoyale.wins === null,
        },
        ...(battleRoyale.gamesPlayed !== null && battleRoyale.gamesPlayed !== undefined
          ? [
              {
                label: t.dashboard.metrics.gamesPlayed,
                value: formatNumber(battleRoyale.gamesPlayed),
                isNull: false,
              },
            ]
          : []),
        ...(battleRoyale.winLossRatio !== null && battleRoyale.winLossRatio !== undefined
          ? [
              {
                label: t.dashboard.metrics.winLossRatio,
                value: formatNumber(battleRoyale.winLossRatio, 2),
                isNull: false,
              },
            ]
          : []),
        ...(battleRoyale.accuracyPercent !== null && battleRoyale.accuracyPercent !== undefined
          ? [
              {
                label: t.dashboard.metrics.accuracy,
                value: `${formatNumber(battleRoyale.accuracyPercent, 2)}%`,
                isNull: false,
              },
            ]
          : []),
      ],
      resurgence: [
        {
          label: t.dashboard.metrics.timePlayed,
          value: formatDurationMinutes(resurgence.timePlayedMinutes),
          isNull: resurgence.timePlayedMinutes === null,
        },
        {
          label: t.dashboard.metrics.kills,
          value: formatNumber(resurgence.kills),
          isNull: resurgence.kills === null,
        },
        {
          label: t.dashboard.metrics.kdRatio,
          value: formatNumber(resurgence.kdRatio, 2),
          isNull: resurgence.kdRatio === null,
        },
        {
          label: t.dashboard.metrics.highestKillsPerGame,
          value: formatNumber(resurgence.highestKillsPerGame),
          isNull: resurgence.highestKillsPerGame === null,
        },
        {
          label: t.dashboard.metrics.wins,
          value: formatNumber(resurgence.wins),
          isNull: resurgence.wins === null,
        },
        ...(resurgence.gamesPlayed !== null && resurgence.gamesPlayed !== undefined
          ? [
              {
                label: t.dashboard.metrics.gamesPlayed,
                value: formatNumber(resurgence.gamesPlayed),
                isNull: false,
              },
            ]
          : []),
        ...(resurgence.winLossRatio !== null && resurgence.winLossRatio !== undefined
          ? [
              {
                label: t.dashboard.metrics.winLossRatio,
                value: formatNumber(resurgence.winLossRatio, 2),
                isNull: false,
              },
            ]
          : []),
        ...(resurgence.accuracyPercent !== null && resurgence.accuracyPercent !== undefined
          ? [
              {
                label: t.dashboard.metrics.accuracy,
                value: `${formatNumber(resurgence.accuracyPercent, 2)}%`,
                isNull: false,
              },
            ]
          : []),
      ],
    };
  }, [formatDurationMinutes, formatNumber, stats.modes, t]);

  const modeDurationRows = useMemo(() => {
    const rows = MODE_ORDER.map((mode) => ({
      mode,
      label: t.dashboard.tabs[mode],
      minutes: stats.modes[mode].timePlayedMinutes ?? 0,
      hasData: stats.modes[mode].timePlayedMinutes !== null,
      display: formatDurationMinutes(stats.modes[mode].timePlayedMinutes),
    }));
    const maxMinutes = Math.max(1, ...rows.map((r) => r.minutes));
    const topMode = rows.reduce((best, item) =>
      item.minutes > best.minutes ? item : best,
    );
    const highlightedMode: GameModeKey =
      selectedTab === 'overview' ? topMode.mode : selectedTab;
    return { rows, maxMinutes, highlightedMode };
  }, [formatDurationMinutes, selectedTab, stats.modes, t.dashboard.tabs]);

  const sourceLabel =
    source === 'cached'
      ? t.dashboard.cachedSource
      : source === 'live'
        ? t.dashboard.liveSource
        : t.dashboard.staleSource;

  const showParsedLabel =
    stats.parsedActivisionId &&
    stats.parsedActivisionId.toLowerCase() !== stats.activisionId.toLowerCase();

  const seasonDisplay =
    !stats.season || stats.season.trim().toLowerCase() === 'season 01'
      ? t.dashboard.seasonLabel
      : stats.season;

  const formatOutcome = (
    value: number | null,
    singular: string,
    plural: string,
  ): string => {
    if (value === null) {
      return '--';
    }
    return `${formatNumber(value)} ${value === 1 ? singular : plural}`;
  };

  return (
    <section className="panel-enter mt-6">
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div>
          <h2 className="text-[24px] leading-[1.2] font-medium font-mono-tabular text-[var(--text-primary)]">
            {stats.activisionId}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] font-mono-tabular text-[var(--text-muted)]">
            <span>{seasonDisplay}</span>
            <span>·</span>
            <span className="text-[var(--text-secondary)]">{sourceLabel}</span>
            <span>·</span>
            <span>{formatRelativeTime(stats.fetchedAt)}</span>
            {showParsedLabel ? (
              <>
                <span>·</span>
                <span>
                  {t.dashboard.parsedIdNote}: {stats.parsedActivisionId}
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopyLink()}
            className="h-9 px-3.5 rounded-[8px] bg-[var(--bg-raised)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] inline-flex items-center gap-2 active:scale-[0.98] transition-[border-color,transform] duration-150 cursor-pointer"
          >
            {copied ? (
              <Check size={16} strokeWidth={1.5} className="text-[var(--positive)]" aria-hidden="true" />
            ) : (
              <Copy size={16} strokeWidth={1.5} className="text-[var(--text-secondary)]" aria-hidden="true" />
            )}
            <span>{copied ? t.dashboard.copiedLink : t.dashboard.copyLinkButton}</span>
          </button>

          <button
            type="button"
            disabled={isRefreshing}
            onClick={onRefresh}
            className="h-9 px-3.5 rounded-[8px] bg-[var(--bg-raised)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] inline-flex items-center gap-2 active:scale-[0.98] disabled:opacity-50 transition-[border-color,transform] duration-150 cursor-pointer"
          >
            <RefreshCw size={16} strokeWidth={1.5} className="text-[var(--text-secondary)]" aria-hidden="true" />
            <span>{t.dashboard.refreshButton}</span>
          </button>
        </div>
      </div>

      {/* Accessible single-row tablist */}
      <div
        ref={tablistRef}
        role="tablist"
        aria-label={t.dashboard.summaryTable.title}
        onKeyDown={handleTabKeyDown}
        className="mode-tablist"
      >
        {TAB_KEYS.map((key) => {
          const isSelected = selectedTab === key;
          return (
            <button
              key={key}
              ref={(el) => {
                tabRefs.current[key] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${key}`}
              aria-selected={isSelected}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => selectTab(key, false)}
              className="mode-tab"
            >
              {t.dashboard.tabs[key]}
            </button>
          );
        })}
      </div>

      {/* Stacked tab panels (padding/surfaces strictly on child wrapper for hidden="until-found") */}
      <div className="tabpanel-stack mt-5">
        {TAB_KEYS.map((key) => {
          const isActive = selectedTab === key;
          const cards = cardsByTab[key];
          return (
            <div
              key={key}
              ref={(el) => {
                panelRefs.current[key] = el;
              }}
              role="tabpanel"
              aria-labelledby={`tab-${key}`}
              tabIndex={isActive ? 0 : undefined}
            >
              <div
                className={
                  cards.length > 5
                    ? 'grid grid-cols-2 sm:grid-cols-4 gap-4'
                    : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4'
                }
              >
                {cards.map((card) => (
                  <div
                    key={card.label}
                    className="p-5 rounded-[12px] bg-[var(--bg-card)] border border-[var(--border-hairline)] flex flex-col justify-between gap-3"
                  >
                    <span className="text-[13px] leading-5 text-[var(--text-secondary)]">
                      {card.label}
                    </span>
                    <span
                      className={[
                        'text-[28px] leading-none font-medium font-mono-tabular',
                        card.isNull
                          ? 'text-[var(--text-muted)]'
                          : 'text-[var(--text-primary)]',
                      ].join(' ')}
                    >
                      {card.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Asymmetric lower data layout: 2/3 primary comparison chart + 1/3 mode table & original card */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Primary chart */}
        <div className="lg:col-span-8 p-6 rounded-[12px] bg-[var(--bg-card)] border border-[var(--border-hairline)]">
          <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4 border-b border-[var(--border-hairline)]">
            <div>
              <h3 className="text-[16px] font-medium text-[var(--text-primary)]">
                {t.dashboard.chart.title}
              </h3>
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                {t.dashboard.chart.subtitle}
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            {modeDurationRows.rows.map((row) => {
              const pct = row.hasData
                ? Math.max(4, Math.round((row.minutes / modeDurationRows.maxMinutes) * 100))
                : 0;
              const isHighlighted = row.mode === modeDurationRows.highlightedMode;

              return (
                <button
                  key={row.mode}
                  type="button"
                  onClick={() => selectTab(row.mode, false)}
                  className="w-full text-left group cursor-pointer"
                >
                  <div className="flex items-baseline justify-between gap-4 mb-2">
                    <span
                      className={[
                        'text-[14px] font-medium transition-colors duration-150',
                        isHighlighted
                          ? 'text-[var(--text-primary)]'
                          : 'text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]',
                      ].join(' ')}
                    >
                      {row.label}
                    </span>
                    <span className="text-[13px] font-mono-tabular text-[var(--text-secondary)]">
                      {row.hasData
                        ? `${row.display} (${formatNumber(row.minutes)} ${t.dashboard.chart.minutesUnit})`
                        : t.dashboard.chart.unplayed}
                    </span>
                  </div>
                  <div className="h-6 rounded-[6px] bg-[var(--bg-page)] border border-[var(--border-hairline)] overflow-hidden flex items-center">
                    {row.hasData ? (
                      <div
                        className="h-full rounded-[4px] transition-[background-color,width] duration-300"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: isHighlighted ? 'var(--accent)' : '#3a3a3f',
                        }}
                      />
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right rail: compact mode summary table + original @CODCombatRecord card */}
        <div className="lg:col-span-4 space-y-6">
          <div className="p-5 rounded-[12px] bg-[var(--bg-card)] border border-[var(--border-hairline)]">
            <h3 className="text-[15px] font-medium text-[var(--text-primary)] pb-3 border-b border-[var(--border-hairline)]">
              {t.dashboard.summaryTable.title}
            </h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="text-[12px] text-[var(--text-muted)] border-b border-[var(--border-hairline)]">
                    <th className="py-2 pr-2 font-normal">{t.dashboard.summaryTable.colMode}</th>
                    <th className="py-2 px-2 font-normal text-right">
                      {t.dashboard.summaryTable.colTime}
                    </th>
                    <th className="py-2 px-2 font-normal text-right">
                      {t.dashboard.summaryTable.colKills}
                    </th>
                    <th className="py-2 pl-2 font-normal text-right">
                      {t.dashboard.summaryTable.colPrimaryRate}
                    </th>
                  </tr>
                </thead>
                <tbody className="text-[13px] font-mono-tabular divide-y divide-[var(--border-hairline)]">
                  <tr
                    onClick={() => selectTab('multiplayer', false)}
                    className="hover:bg-[var(--bg-raised)] cursor-pointer transition-colors duration-150"
                  >
                    <td className="py-2.5 pr-2 font-sans text-[var(--text-primary)]">
                      {t.dashboard.tabs.multiplayer}
                    </td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap text-[var(--text-secondary)]">
                      {formatDurationMinutes(stats.modes.multiplayer.timePlayedMinutes)}
                    </td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap text-[var(--text-primary)]">
                      {formatNumber(stats.modes.multiplayer.kills)}
                    </td>
                    <td className="py-2.5 pl-2 text-right whitespace-nowrap text-[var(--text-secondary)]">
                      {formatOutcome(
                        stats.modes.multiplayer.wins,
                        t.dashboard.summaryTable.winSingular,
                        t.dashboard.summaryTable.winsLabel,
                      )}
                    </td>
                  </tr>

                  <tr
                    onClick={() => selectTab('dmz', false)}
                    className="hover:bg-[var(--bg-raised)] cursor-pointer transition-colors duration-150"
                  >
                    <td className="py-2.5 pr-2 font-sans text-[var(--text-primary)]">
                      {t.dashboard.tabs.dmz}
                    </td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap text-[var(--text-secondary)]">
                      {formatDurationMinutes(stats.modes.dmz.timePlayedMinutes)}
                    </td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap text-[var(--text-primary)]">
                      {formatNumber(stats.modes.dmz.playerEliminations)}
                    </td>
                    <td className="py-2.5 pl-2 text-right whitespace-nowrap text-[var(--text-secondary)]">
                      {formatOutcome(
                        stats.modes.dmz.successfulExfils,
                        t.dashboard.summaryTable.exfilSingular,
                        t.dashboard.summaryTable.exfilsLabel,
                      )}
                    </td>
                  </tr>

                  <tr
                    onClick={() => selectTab('battleRoyale', false)}
                    className="hover:bg-[var(--bg-raised)] cursor-pointer transition-colors duration-150"
                  >
                    <td className="py-2.5 pr-2 font-sans text-[var(--text-primary)]">
                      {t.dashboard.tabs.battleRoyale}
                    </td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap text-[var(--text-secondary)]">
                      {formatDurationMinutes(stats.modes.battleRoyale.timePlayedMinutes)}
                    </td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap text-[var(--text-primary)]">
                      {formatNumber(stats.modes.battleRoyale.kills)}
                    </td>
                    <td className="py-2.5 pl-2 text-right whitespace-nowrap text-[var(--text-secondary)]">
                      {formatOutcome(
                        stats.modes.battleRoyale.wins,
                        t.dashboard.summaryTable.winSingular,
                        t.dashboard.summaryTable.winsLabel,
                      )}
                    </td>
                  </tr>

                  <tr
                    onClick={() => selectTab('resurgence', false)}
                    className="hover:bg-[var(--bg-raised)] cursor-pointer transition-colors duration-150"
                  >
                    <td className="py-2.5 pr-2 font-sans text-[var(--text-primary)]">
                      {t.dashboard.tabs.resurgence}
                    </td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap text-[var(--text-secondary)]">
                      {formatDurationMinutes(stats.modes.resurgence.timePlayedMinutes)}
                    </td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap text-[var(--text-primary)]">
                      {formatNumber(stats.modes.resurgence.kills)}
                    </td>
                    <td className="py-2.5 pl-2 text-right whitespace-nowrap text-[var(--text-secondary)]">
                      {formatOutcome(
                        stats.modes.resurgence.wins,
                        t.dashboard.summaryTable.winSingular,
                        t.dashboard.summaryTable.winsLabel,
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="p-5 rounded-[12px] bg-[var(--bg-card)] border border-[var(--border-hairline)]">
            <h3 className="text-[15px] font-medium text-[var(--text-primary)]">
              {t.dashboard.cardViewer.title}
            </h3>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              {t.dashboard.cardViewer.subtitle}
            </p>

            {stats.localImagePath ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-[8px] overflow-hidden border border-[var(--border-hairline)] bg-[var(--bg-deep)]">
                  <img
                    src={stats.localImagePath}
                    alt={`${stats.activisionId} @CODCombatRecord card`}
                    className="w-full h-auto block"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => dialogRef.current?.showModal()}
                  className="w-full h-9 px-3.5 rounded-[8px] bg-[var(--bg-raised)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] text-[13px] font-medium text-[var(--text-primary)] inline-flex items-center justify-center gap-2 active:scale-[0.98] transition-[border-color,transform] duration-150 cursor-pointer"
                >
                  <Maximize2 size={16} strokeWidth={1.5} className="text-[var(--text-secondary)]" aria-hidden="true" />
                  <span>{t.dashboard.cardViewer.openButton}</span>
                </button>
              </div>
            ) : (
              <p className="mt-3 text-[13px] text-[var(--text-muted)]">
                {t.dashboard.cardViewer.unavailable}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Native top-layer modal dialog with light-dismiss */}
      <dialog
        ref={dialogRef}
        className="card-dialog"
        {...({ closedby: 'any' } as Record<string, string>)}
        aria-labelledby="card-dialog-title"
      >
        <div className="p-4 border-b border-[var(--border-hairline)] flex items-center justify-between gap-4">
          <h3 id="card-dialog-title" className="text-[15px] font-medium text-[var(--text-primary)]">
            {t.dashboard.cardViewer.dialogTitle} — {stats.activisionId}
          </h3>
          <form method="dialog">
            <button
              type="submit"
              aria-label={t.dashboard.cardViewer.closeButton}
              className="h-8 px-2.5 rounded-[6px] bg-[var(--bg-raised)] border border-[var(--border-hairline)] hover:border-[var(--border-strong)] text-[13px] text-[var(--text-primary)] inline-flex items-center gap-1.5 cursor-pointer"
            >
              <X size={16} strokeWidth={1.5} className="text-[var(--text-secondary)]" aria-hidden="true" />
              <span>{t.dashboard.cardViewer.closeButton}</span>
            </button>
          </form>
        </div>
        {stats.localImagePath ? (
          <div className="p-4 bg-[var(--bg-deep)]">
            <img
              src={stats.localImagePath}
              alt={`${stats.activisionId} full combat record card`}
              className="max-w-full max-h-[75vh] w-auto h-auto mx-auto rounded-[8px] block"
            />
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
