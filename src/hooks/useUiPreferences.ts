import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';

type UiPreferenceField = 'hideExportRow' | 'showTimestamps' | 'sidebarCollapsed';

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

type LegacyUiPreferences = Record<UiPreferenceField, boolean | null>;
type UiPreferenceMeta = {
  settingKey: string;
  persistWarning: string;
  migrationWarning: string;
};

const DEFAULT_UI_PREFERENCES: UiPreferencesState = {
  hideExportRow: false,
  showTimestamps: true,
  sidebarCollapsed: false,
};

// TODO(#38): Remove this legacy localStorage migration layer after the DB-backed preferences rollout window.
const LEGACY_STORAGE_KEYS: Record<UiPreferenceField, string> = {
  hideExportRow: 'boards.hideExportRow',
  showTimestamps: 'boards.showTimestamps',
  sidebarCollapsed: 'boards.sidebarCollapsed',
};

const PREFERENCE_META: Record<UiPreferenceField, UiPreferenceMeta> = {
  hideExportRow: {
    settingKey: 'hide_export_row',
    persistWarning: 'Failed to persist hide export row preference:',
    migrationWarning: 'Failed to migrate hide export row preference:',
  },
  showTimestamps: {
    settingKey: 'show_timestamps',
    persistWarning: 'Failed to persist show timestamps preference:',
    migrationWarning: 'Failed to migrate show timestamps preference:',
  },
  sidebarCollapsed: {
    settingKey: 'sidebar_collapsed',
    persistWarning: 'Failed to persist sidebar collapsed preference:',
    migrationWarning: 'Failed to migrate sidebar collapsed preference:',
  },
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

const readLegacyPreferences = (): LegacyUiPreferences => ({
  hideExportRow: parseLegacyBoolean(LEGACY_STORAGE_KEYS.hideExportRow),
  showTimestamps: parseLegacyBoolean(LEGACY_STORAGE_KEYS.showTimestamps),
  sidebarCollapsed: parseLegacyBoolean(LEGACY_STORAGE_KEYS.sidebarCollapsed),
});

const persistUiPreference = (
  field: UiPreferenceField,
  value: boolean,
  useMigrationWarning = false,
) => {
  const { settingKey, persistWarning, migrationWarning } = PREFERENCE_META[field];
  const warning = useMigrationWarning ? migrationWarning : persistWarning;

  void invoke('set_ui_preference', { key: settingKey, value }).catch((error) => {
    console.warn(warning, error);
  });
};

const buildInitialPreferences = (legacy: LegacyUiPreferences): UiPreferencesState => ({
  hideExportRow: legacy.hideExportRow ?? DEFAULT_UI_PREFERENCES.hideExportRow,
  showTimestamps: legacy.showTimestamps ?? DEFAULT_UI_PREFERENCES.showTimestamps,
  sidebarCollapsed: legacy.sidebarCollapsed ?? DEFAULT_UI_PREFERENCES.sidebarCollapsed,
});

const resolveStoredPreferences = (
  stored: UiPreferencesResponse,
  legacy: LegacyUiPreferences,
): UiPreferencesState => ({
  hideExportRow:
    stored.hide_export_row ?? legacy.hideExportRow ?? DEFAULT_UI_PREFERENCES.hideExportRow,
  showTimestamps:
    stored.show_timestamps ?? legacy.showTimestamps ?? DEFAULT_UI_PREFERENCES.showTimestamps,
  sidebarCollapsed:
    stored.sidebar_collapsed ?? legacy.sidebarCollapsed ?? DEFAULT_UI_PREFERENCES.sidebarCollapsed,
});

const getStoredValue = (
  stored: UiPreferencesResponse,
  field: UiPreferenceField,
): boolean | null => {
  switch (field) {
    case 'hideExportRow':
      return stored.hide_export_row;
    case 'showTimestamps':
      return stored.show_timestamps;
    case 'sidebarCollapsed':
      return stored.sidebar_collapsed;
  }
};

const migrateLegacyPreferences = (stored: UiPreferencesResponse, legacy: LegacyUiPreferences) => {
  const fields: UiPreferenceField[] = ['hideExportRow', 'showTimestamps', 'sidebarCollapsed'];
  for (const field of fields) {
    const storedValue = getStoredValue(stored, field);
    const legacyValue = legacy[field];
    if (storedValue === null && legacyValue !== null) {
      persistUiPreference(field, legacyValue, true);
    }
  }
};

const applyPreferenceUpdate = (
  setPreferences: Dispatch<SetStateAction<UiPreferencesState>>,
  field: UiPreferenceField,
  value: boolean,
) => {
  setPreferences((current) =>
    current[field] === value ? current : { ...current, [field]: value },
  );
};

const updatePreference = (
  setPreferences: Dispatch<SetStateAction<UiPreferencesState>>,
  field: UiPreferenceField,
  value: boolean,
  preferencesLoaded: boolean,
) => {
  applyPreferenceUpdate(setPreferences, field, value);
  if (preferencesLoaded) {
    persistUiPreference(field, value);
  }
};

export function useUiPreferences() {
  const legacyPreferences = useMemo(() => readLegacyPreferences(), []);
  const [preferences, setPreferences] = useState<UiPreferencesState>(() =>
    buildInitialPreferences(legacyPreferences),
  );
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const handleLoadedPreferences = (storedPreferences: UiPreferencesResponse) => {
      if (cancelled) return;

      setPreferences(resolveStoredPreferences(storedPreferences, legacyPreferences));
      setPreferencesLoaded(true);
      migrateLegacyPreferences(storedPreferences, legacyPreferences);
    };

    const handleLoadError = (error: unknown) => {
      if (cancelled) return;
      console.warn('Failed to load UI preferences from backend:', error);
      setPreferencesLoaded(true);
    };

    void invoke<UiPreferencesResponse>('get_ui_preferences')
      .then(handleLoadedPreferences)
      .catch(handleLoadError);

    return () => {
      cancelled = true;
    };
  }, [legacyPreferences]);

  const setHideExportRow = useCallback(
    (value: boolean) => updatePreference(setPreferences, 'hideExportRow', value, preferencesLoaded),
    [preferencesLoaded],
  );

  const setShowTimestamps = useCallback(
    (value: boolean) =>
      updatePreference(setPreferences, 'showTimestamps', value, preferencesLoaded),
    [preferencesLoaded],
  );

  const toggleSidebar = useCallback(() => {
    setPreferences((current) => {
      const nextValue = !current.sidebarCollapsed;
      if (preferencesLoaded) {
        persistUiPreference('sidebarCollapsed', nextValue);
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
