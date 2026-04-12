import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

const LEGACY_HIDE_EXPORT_ROW_STORAGE_KEY = 'boards.hideExportRow';
const LEGACY_SHOW_TIMESTAMPS_STORAGE_KEY = 'boards.showTimestamps';
const LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY = 'boards.sidebarCollapsed';

interface UiPreferencesResponse {
  hide_export_row: boolean | null;
  show_timestamps: boolean | null;
  sidebar_collapsed: boolean | null;
}

interface UiPreferencesState {
  hideExportRow: boolean;
  showTimestamps: boolean;
  sidebarCollapsed: boolean;
}

const DEFAULT_UI_PREFERENCES: UiPreferencesState = {
  hideExportRow: false,
  showTimestamps: true,
  sidebarCollapsed: false,
};

const parseLegacyBoolean = (storageKey: string): boolean | null => {
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored === null) {
      return null;
    }
    return Boolean(JSON.parse(stored));
  } catch {
    return null;
  }
};

const persistUiPreference = (key: string, value: boolean, warning: string) => {
  void invoke('set_ui_preference', { key, value }).catch((error) => {
    console.warn(warning, error);
  });
};

export function useUiPreferences() {
  const legacyPreferences = useMemo(
    () => ({
      hideExportRow: parseLegacyBoolean(LEGACY_HIDE_EXPORT_ROW_STORAGE_KEY),
      showTimestamps: parseLegacyBoolean(LEGACY_SHOW_TIMESTAMPS_STORAGE_KEY),
      sidebarCollapsed: parseLegacyBoolean(LEGACY_SIDEBAR_COLLAPSED_STORAGE_KEY),
    }),
    [],
  );

  const [preferences, setPreferences] = useState<UiPreferencesState>(() => ({
    hideExportRow: legacyPreferences.hideExportRow ?? DEFAULT_UI_PREFERENCES.hideExportRow,
    showTimestamps: legacyPreferences.showTimestamps ?? DEFAULT_UI_PREFERENCES.showTimestamps,
    sidebarCollapsed: legacyPreferences.sidebarCollapsed ?? DEFAULT_UI_PREFERENCES.sidebarCollapsed,
  }));
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void invoke<UiPreferencesResponse>('get_ui_preferences')
      .then((storedPreferences) => {
        if (cancelled) return;

        const nextPreferences: UiPreferencesState = {
          hideExportRow:
            storedPreferences.hide_export_row ??
            legacyPreferences.hideExportRow ??
            DEFAULT_UI_PREFERENCES.hideExportRow,
          showTimestamps:
            storedPreferences.show_timestamps ??
            legacyPreferences.showTimestamps ??
            DEFAULT_UI_PREFERENCES.showTimestamps,
          sidebarCollapsed:
            storedPreferences.sidebar_collapsed ??
            legacyPreferences.sidebarCollapsed ??
            DEFAULT_UI_PREFERENCES.sidebarCollapsed,
        };

        setPreferences(nextPreferences);
        setPreferencesLoaded(true);

        if (
          storedPreferences.hide_export_row === null &&
          legacyPreferences.hideExportRow !== null
        ) {
          persistUiPreference(
            'hide_export_row',
            legacyPreferences.hideExportRow,
            'Failed to migrate hide export row preference:',
          );
        }
        if (
          storedPreferences.show_timestamps === null &&
          legacyPreferences.showTimestamps !== null
        ) {
          persistUiPreference(
            'show_timestamps',
            legacyPreferences.showTimestamps,
            'Failed to migrate show timestamps preference:',
          );
        }
        if (
          storedPreferences.sidebar_collapsed === null &&
          legacyPreferences.sidebarCollapsed !== null
        ) {
          persistUiPreference(
            'sidebar_collapsed',
            legacyPreferences.sidebarCollapsed,
            'Failed to migrate sidebar collapsed preference:',
          );
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Failed to load UI preferences from backend:', error);
        setPreferencesLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [legacyPreferences]);

  const setHideExportRow = useCallback(
    (value: boolean) => {
      setPreferences((current) =>
        current.hideExportRow === value ? current : { ...current, hideExportRow: value },
      );
      if (preferencesLoaded) {
        persistUiPreference(
          'hide_export_row',
          value,
          'Failed to persist hide export row preference:',
        );
      }
    },
    [preferencesLoaded],
  );

  const setShowTimestamps = useCallback(
    (value: boolean) => {
      setPreferences((current) =>
        current.showTimestamps === value ? current : { ...current, showTimestamps: value },
      );
      if (preferencesLoaded) {
        persistUiPreference(
          'show_timestamps',
          value,
          'Failed to persist show timestamps preference:',
        );
      }
    },
    [preferencesLoaded],
  );

  const toggleSidebar = useCallback(() => {
    setPreferences((current) => {
      const nextValue = !current.sidebarCollapsed;
      if (preferencesLoaded) {
        persistUiPreference(
          'sidebar_collapsed',
          nextValue,
          'Failed to persist sidebar collapsed preference:',
        );
      }
      return { ...current, sidebarCollapsed: nextValue };
    });
  }, [preferencesLoaded]);

  return {
    hideExportRow: preferences.hideExportRow,
    showTimestamps: preferences.showTimestamps,
    sidebarCollapsed: preferences.sidebarCollapsed,
    setHideExportRow,
    setShowTimestamps,
    toggleSidebar,
  };
}
