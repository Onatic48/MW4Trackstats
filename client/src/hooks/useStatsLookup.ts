import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuthStatusResponse,
  CombatRecordStats,
  JobErrorInfo,
  JobStatusResponse,
  RecentPlayerSummary,
} from '@mw4trackstats/shared';
import {
  ApiError,
  fetchAuthStatus,
  fetchCachedPlayer,
  fetchJobStatus,
  fetchRecentLookups,
  logoutX,
  openJobStream,
  requestPlayerStats,
} from '../api/client';

export type StatsSourceKind = 'cached' | 'live' | 'stale';

export interface ActiveJobView {
  jobId: string;
  activisionId: string;
  step: JobStatusResponse['step'];
  state: JobStatusResponse['state'];
  queuePosition: number;
  deduplicated: boolean;
  elapsedSeconds: number;
  staleData: CombatRecordStats | null;
}

export function useStatsLookup() {
  const [auth, setAuth] = useState<AuthStatusResponse | null>(null);
  const [recent, setRecent] = useState<RecentPlayerSummary[]>([]);
  const [stats, setStats] = useState<CombatRecordStats | null>(null);
  const [source, setSource] = useState<StatsSourceKind>('cached');
  const [activeJob, setActiveJob] = useState<ActiveJobView | null>(null);
  const [error, setError] = useState<JobErrorInfo | null>(null);
  const [pendingLoginId, setPendingLoginId] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const cleanupStreamRef = useRef<(() => void) | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);

  const stopTracking = useCallback(() => {
    cleanupStreamRef.current?.();
    cleanupStreamRef.current = null;
    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (elapsedTimerRef.current !== null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }, []);

  const refreshMetadata = useCallback(async () => {
    const [authRes, recentRes] = await Promise.allSettled([
      fetchAuthStatus(),
      fetchRecentLookups(),
    ]);
    if (authRes.status === 'fulfilled') {
      setAuth(authRes.value);
    }
    if (recentRes.status === 'fulfilled') {
      setRecent(recentRes.value);
    }
  }, []);

  const initialMetadataFetchedRef = useRef(false);
  useEffect(() => {
    if (!initialMetadataFetchedRef.current) {
      initialMetadataFetchedRef.current = true;
      void refreshMetadata();
    }
    return () => stopTracking();
  }, [refreshMetadata, stopTracking]);

  const syncUrlId = useCallback((activisionId: string) => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('id', activisionId);
      url.searchParams.delete('autolookup');
      url.searchParams.delete('authError');
      window.history.replaceState(null, '', url.toString());
    } catch {
      // Ignore history restrictions
    }
  }, []);

  const handleTerminalJob = useCallback(
    (status: JobStatusResponse) => {
      stopTracking();
      setIsSubmitting(false);

      if (status.state === 'completed' && status.result) {
        setActiveJob(null);
        setError(null);
        setPendingLoginId(null);
        setStats(status.result);
        setSource('live');
        syncUrlId(status.result.activisionId);
        void refreshMetadata();
        return;
      }

      if (status.state === 'failed') {
        setActiveJob(null);
        const err = status.error ?? {
          code: 'INTERNAL_ERROR' as const,
          message: 'Lookup failed',
        };
        if (err.code === 'USER_X_LOGIN_REQUIRED') {
          setPendingLoginId(status.activisionId);
          setError(null);
          void refreshMetadata();
        } else {
          setError(err);
        }
        if (status.staleData) {
          setStats(status.staleData);
          setSource('stale');
        }
        void refreshMetadata();
      }
    },
    [refreshMetadata, stopTracking, syncUrlId],
  );

  const startPollingFallback = useCallback(
    (jobId: string) => {
      if (pollTimerRef.current !== null) {
        return;
      }
      pollTimerRef.current = window.setInterval(() => {
        void fetchJobStatus(jobId)
          .then((status) => {
            setActiveJob((prev) =>
              prev
                ? {
                    ...prev,
                    step: status.step,
                    state: status.state,
                    queuePosition: status.queuePosition,
                    staleData: status.staleData ?? prev.staleData,
                  }
                : prev,
            );
            if (status.state === 'completed' || status.state === 'failed') {
              handleTerminalJob(status);
            }
          })
          .catch(() => {
            // Keep polling quietly on transient network blips
          });
      }, 1500);
    },
    [handleTerminalJob],
  );

  const submitLookup = useCallback(
    async (rawId: string, forceRefresh = false) => {
      const trimmed = rawId.trim();
      if (!trimmed) {
        return;
      }

      stopTracking();
      setIsSubmitting(true);
      setError(null);
      setPendingLoginId(null);
      setAuthNotice(null);

      try {
        const res = await requestPlayerStats(trimmed, forceRefresh);

        if (res.status === 'cached') {
          setActiveJob(null);
          setStats(res.data);
          setSource('cached');
          setIsSubmitting(false);
          syncUrlId(res.data.activisionId);
          void refreshMetadata();
          return;
        }

        const startedAtMs = Date.now();
        setActiveJob({
          jobId: res.jobId,
          activisionId: res.activisionId,
          step: res.step,
          state: 'queued',
          queuePosition: res.queuePosition,
          deduplicated: res.deduplicated,
          elapsedSeconds: 0,
          staleData: res.staleData,
        });

        if (res.staleData) {
          setStats(res.staleData);
          setSource('stale');
        }

        elapsedTimerRef.current = window.setInterval(() => {
          setActiveJob((prev) =>
            prev
              ? {
                  ...prev,
                  elapsedSeconds: Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)),
                }
              : prev,
          );
        }, 1000);

        cleanupStreamRef.current = openJobStream(
          res.jobId,
          (status) => {
            setActiveJob((prev) =>
              prev
                ? {
                    ...prev,
                    step: status.step,
                    state: status.state,
                    queuePosition: status.queuePosition,
                    staleData: status.staleData ?? prev.staleData,
                  }
                : prev,
            );
            if (status.state === 'completed' || status.state === 'failed') {
              handleTerminalJob(status);
            }
          },
          () => startPollingFallback(res.jobId),
        );
      } catch (err) {
        stopTracking();
        setIsSubmitting(false);
        setActiveJob(null);
        if (err instanceof ApiError) {
          if (err.code === 'USER_X_LOGIN_REQUIRED') {
            setPendingLoginId(trimmed);
            setError(null);
          } else {
            setError({ code: err.code, message: err.message });
          }
        } else {
          setError({
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : 'Unexpected network error',
          });
        }
      }
    },
    [handleTerminalJob, refreshMetadata, startPollingFallback, stopTracking, syncUrlId],
  );

  const viewPlayerRecord = useCallback(
    async (rawId: string) => {
      const trimmed = rawId.trim();
      if (!trimmed) {
        return;
      }

      stopTracking();
      setIsSubmitting(true);
      setError(null);
      setPendingLoginId(null);
      setAuthNotice(null);
      setActiveJob(null);

      try {
        const res = await fetchCachedPlayer(trimmed);
        if (res.found && res.data) {
          setStats(res.data);
          setSource(res.fresh ? 'cached' : 'stale');
          setIsSubmitting(false);
          syncUrlId(res.data.activisionId);
          return;
        }
      } catch (err) {
        setIsSubmitting(false);
        if (err instanceof ApiError) {
          setError({ code: err.code, message: err.message });
        } else {
          setError({
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : 'Unexpected network error',
          });
        }
        return;
      }

      await submitLookup(trimmed, false);
    },
    [stopTracking, submitLookup, syncUrlId],
  );

  const handleLogout = useCallback(async () => {
    try {
      await logoutX();
    } finally {
      setAuth((prev) =>
        prev
          ? { ...prev, authenticated: false, user: null }
          : null,
      );
      void refreshMetadata();
    }
  }, [refreshMetadata]);

  // Check ?id= and ?authError= URL params on initial mount
  const initialCheckedRef = useRef(false);
  useEffect(() => {
    if (initialCheckedRef.current) {
      return;
    }
    initialCheckedRef.current = true;
    const url = new URL(window.location.href);
    const idParam = url.searchParams.get('id');
    const authErrorParam = url.searchParams.get('authError');
    const isAutoLookup = url.searchParams.get('autolookup') === '1';

    if (authErrorParam) {
      setAuthNotice(authErrorParam);
      url.searchParams.delete('authError');
      window.history.replaceState(null, '', url.toString());
    }

    if (url.searchParams.has('autolookup')) {
      url.searchParams.delete('autolookup');
      window.history.replaceState(null, '', url.toString());
    }

    if (idParam && idParam.trim().length > 0) {
      if (isAutoLookup) {
        void submitLookup(idParam, false);
      } else {
        void viewPlayerRecord(idParam);
      }
    }
  }, [submitLookup, viewPlayerRecord]);

  const handleRecordPurged = useCallback(
    (purgedActivisionId: string) => {
      setStats((prev) =>
        prev && prev.activisionId.toLowerCase() === purgedActivisionId.toLowerCase()
          ? null
          : prev,
      );
      void refreshMetadata();
    },
    [refreshMetadata],
  );

  return {
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
    viewPlayerRecord,
    handleLogout,
    handleRecordPurged,
  };
}
