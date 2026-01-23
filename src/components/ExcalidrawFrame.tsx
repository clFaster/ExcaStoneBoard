import { useEffect, useRef, useCallback, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  BinaryFiles,
} from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState } from '@excalidraw/excalidraw/types';
import './ExcalidrawFrame.css';

export interface ExcalidrawData {
  elements: ExcalidrawElement[];
  appState?: Partial<AppState>;
  files?: BinaryFiles;
}

interface ExcalidrawFrameProps {
  boardId: string | null;
  collaborationLink: string | null;
  onDataChange: (data: ExcalidrawData) => void;
  initialData: ExcalidrawData | null;
}

export function ExcalidrawFrame({
  boardId,
  collaborationLink,
  onDataChange,
  initialData,
}: ExcalidrawFrameProps) {
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const [isReady, setIsReady] = useState(false);
  const lastSavedDataRef = useRef<string | null>(null);

  // Debounced save function
  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      if (!excalidrawApiRef.current || !boardId) return;

      const elements = excalidrawApiRef.current.getSceneElements();
      const appState = excalidrawApiRef.current.getAppState();
      const files = excalidrawApiRef.current.getFiles();

      const data: ExcalidrawData = {
        elements: elements as ExcalidrawElement[],
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          currentItemStrokeColor: appState.currentItemStrokeColor,
          currentItemBackgroundColor: appState.currentItemBackgroundColor,
          currentItemFillStyle: appState.currentItemFillStyle,
          currentItemStrokeWidth: appState.currentItemStrokeWidth,
          currentItemRoughness: appState.currentItemRoughness,
          currentItemOpacity: appState.currentItemOpacity,
          currentItemFontFamily: appState.currentItemFontFamily,
          currentItemFontSize: appState.currentItemFontSize,
          currentItemTextAlign: appState.currentItemTextAlign,
          currentItemStartArrowhead: appState.currentItemStartArrowhead,
          currentItemEndArrowhead: appState.currentItemEndArrowhead,
          currentItemRoundness: appState.currentItemRoundness,
          gridSize: appState.gridSize,
          gridStep: appState.gridStep,
          gridModeEnabled: appState.gridModeEnabled,
          zenModeEnabled: appState.zenModeEnabled,
          theme: appState.theme,
        },
        files: files,
      };

      // Only save if data has actually changed
      const dataStr = JSON.stringify(data);
      if (dataStr !== lastSavedDataRef.current) {
        lastSavedDataRef.current = dataStr;
        onDataChange(data);
      }
    }, 1000); // Save 1 second after last change
  }, [boardId, onDataChange]);

  // Handle Excalidraw changes
  const handleChange = useCallback(
    (_elements: readonly ExcalidrawElement[], _appState: AppState, _files: BinaryFiles) => {
      if (!boardId || !isReady) return;
      scheduleSave();
    },
    [boardId, isReady, scheduleSave]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Reset ready state when board changes
  useEffect(() => {
    setIsReady(false);
    lastSavedDataRef.current = null;
  }, [boardId]);

  // Handle collaboration links - open in external browser
  useEffect(() => {
    if (collaborationLink) {
      // For collaboration links, we need to open them externally
      // since the Excalidraw React component doesn't support live collaboration
      window.open(collaborationLink, '_blank');
    }
  }, [collaborationLink]);

  if (!boardId) {
    return (
      <div className="excalidraw-placeholder">
        <div className="placeholder-content">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
          <h3>No Board Selected</h3>
          <p>Select a board from the sidebar or create a new one to get started</p>
        </div>
      </div>
    );
  }

  // Prepare initial data for Excalidraw
  const getInitialData = (): ExcalidrawInitialDataState | undefined => {
    if (!initialData) {
      return {
        elements: [],
        appState: {
          viewBackgroundColor: '#ffffff',
          theme: 'dark',
        },
      };
    }

    return {
      elements: initialData.elements || [],
      appState: {
        ...initialData.appState,
        theme: initialData.appState?.theme || 'dark',
      },
      files: initialData.files,
    };
  };

  return (
    <div className="excalidraw-frame">
      <Excalidraw
        excalidrawAPI={(api) => {
          excalidrawApiRef.current = api;
          setIsReady(true);
        }}
        initialData={getInitialData()}
        onChange={handleChange}
        theme="dark"
        UIOptions={{
          canvasActions: {
            loadScene: true,
            saveToActiveFile: false,
            export: { saveFileToDisk: true },
          },
        }}
      />
    </div>
  );
}
