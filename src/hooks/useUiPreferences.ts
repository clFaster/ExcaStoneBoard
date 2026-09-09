import { useCallback, useEffect, useState } from 'react';
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

type UiPreferenceMeta = {
  settingKey: string;
  persistWarning: string;
};

const DEFAULT_UI_PREFERENCES: UiPreferencesState = {
  hideExportRow: false,
  showTimestamps: true,
  sidebarCollapsed: false,
};

const PREFERENCE_META: Record<UiPreferenceField, UiPreferenceMeta> = {
  hideExportRow: {
    settingKey: 'hide_export_row',
    persistWarning: 'Failed to persist hide export row preference:',
  },
  showTimestamps: {
    settingKey: 'show_timestamps',
    persistWarning: 'Failed to persist show timestamps preference:',
  },
  sidebarCollapsed: {
    settingKey: 'sidebar_collapsed',
    persistWarning: 'Failed to persist sidebar collapsed preference:',
  },
};

const persistUiPreference = (field: UiPreferenceField, value: boolean) => {
  const { settingKey, persistWarning } = PREFERENCE_META[field];
  void invoke('set_ui_preference', { key: settingKey, value }).catch((error) => {
    console.warn(persistWarning, error);
  });
};

const resolveStoredPreferences = (stored: UiPreferencesResponse): UiPreferencesState => ({
  hideExportRow: stored.hide_export_row ?? DEFAULT_UI_PREFERENCES.hideExportRow,
  showTimestamps: stored.show_timestamps ?? DEFAULT_UI_PREFERENCES.showTimestamps,
  sidebarCollapsed: stored.sidebar_collapsed ?? DEFAULT_UI_PREFERENCES.sidebarCollapsed,
});

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
  const [preferences, setPreferences] = useState<UiPreferencesState>(DEFAULT_UI_PREFERENCES);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const handleLoadedPreferences = (storedPreferences: UiPreferencesResponse) => {
      if (cancelled) return;

      setPreferences(resolveStoredPreferences(storedPreferences));
      setPreferencesLoaded(true);
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
  }, []);

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
