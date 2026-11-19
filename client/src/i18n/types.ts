export type Locale = 'en' | 'tr';

export const SUPPORTED_LOCALES: readonly { code: Locale; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'tr', label: 'TR' },
] as const;

export interface Translations {
  brand: {
    name: string;
    subtitle: string;
  };
  topBar: {
    languageLabel: string;
    adapterDemo: string;
    adapterPlaywright: string;
    adapterApi: string;
    statusReady: string;
    statusUnavailable: string;
    queueLabel: string;
  };
  auth: {
    signInWithX: string;
    signOut: string;
    connectedAs: string;
    loginRequiredTitle: string;
    loginRequiredBody: string;
    authDeniedError: string;
    authExpiredError: string;
  };
  search: {
    headline: string;
    description: string;
    inputLabel: string;
    formatHint: string;
    placeholder: string;
    submitButton: string;
    submittingButton: string;
    shortcutHint: string;
    invalidError: string;
    samplePrefix: string;
  };
  progress: {
    activeTitle: string;
    deduplicatedNotice: string;
    queuePositionLabel: string;
    elapsedLabel: string;
    staleShowingNotice: string;
    steps: {
      cache: string;
      posting: string;
      waiting: string;
      parsing: string;
    };
  };
  errors: {
    heading: string;
    retryButton: string;
    fallbackBanner: string;
    rateLimited: string;
    xRateLimited: string;
    xChallenge: string;
    xAuth: string;
    botTimeout: string;
    botNoStats: string;
    parseFailed: string;
    generic: string;
  };
  dashboard: {
    seasonLabel: string;
    cachedSource: string;
    liveSource: string;
    staleSource: string;
    refreshButton: string;
    copyLinkButton: string;
    copiedLink: string;
    parsedIdNote: string;
    tabs: {
      overview: string;
      multiplayer: string;
      dmz: string;
      battleRoyale: string;
      resurgence: string;
    };
    metrics: {
      timePlayed: string;
      kills: string;
      kdRatio: string;
      highestStreak: string;
      wins: string;
      gamesPlayed: string;
      winLossRatio: string;
      accuracy: string;
      playerEliminations: string;
      hostileEliminations: string;
      containersOpened: string;
      successfulExfils: string;
      dynamicOps: string;
      medicalItems: string;
      highestKillsPerGame: string;
    };
    chart: {
      title: string;
      subtitle: string;
      unplayed: string;
      minutesUnit: string;
    };
    summaryTable: {
      title: string;
      colMode: string;
      colTime: string;
      colKills: string;
      colPrimaryRate: string;
      exfilsLabel: string;
      exfilSingular: string;
      winsLabel: string;
      winSingular: string;
    };
    cardViewer: {
      title: string;
      subtitle: string;
      openButton: string;
      openOnXButton: string;
      closeButton: string;
      dialogTitle: string;
      unavailable: string;
    };
  };
  recent: {
    title: string;
    subtitle: string;
    empty: string;
    colPlayer: string;
    colMpKd: string;
    colResKills: string;
    colDmzExfils: string;
    colFreshness: string;
    freshBadge: string;
    expiredBadge: string;
  };
  time: {
    justNow: string;
    minutesAgo: string;
    hoursAgo: string;
    daysShort: string;
    hoursShort: string;
    minutesShort: string;
  };
  legal: {
    footerDisclaimer: string;
    trademarkNotice: string;
    termsButton: string;
    privacyButton: string;
    removeDataButton: string;
    modalTitle: string;
    closeButton: string;
    termsHeading: string;
    termsBody: string;
    xAutomationHeading: string;
    xAutomationBody: string;
    privacyHeading: string;
    privacyBody: string;
    cookiesHeading: string;
    cookiesBody: string;
    removalHeading: string;
    removalDescription: string;
    removalInputPlaceholder: string;
    removalSubmitButton: string;
    removalSubmittingButton: string;
    removalSuccessFound: string;
    removalSuccessNotFound: string;
  };
}
