import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Excalidraw, exportToBlob, exportToClipboard, exportToSvg, MIME_TYPES } from '@excalidraw/excalidraw';
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
  onDataChange: (data: ExcalidrawData) => void;
  initialData: ExcalidrawData | null;
}

export interface ExcalidrawFrameHandle {
  exportPng: () => Promise<void>;
  copyPng: () => Promise<void>;
  exportSvg: () => Promise<void>;
}

export const ExcalidrawFrame = forwardRef<ExcalidrawFrameHandle, ExcalidrawFrameProps>(function ExcalidrawFrame(
  { boardId, onDataChange, initialData }: ExcalidrawFrameProps,
  ref
) {
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const [isReady, setIsReady] = useState(false);
  const lastSavedDataRef = useRef<string | null>(null);

  const downloadFile = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, []);

  const exportPng = useCallback(async () => {
    if (!excalidrawApiRef.current) return;

    const elements = excalidrawApiRef.current.getSceneElements();
    const appState = excalidrawApiRef.current.getAppState();
    const files = excalidrawApiRef.current.getFiles();

    const blob = await exportToBlob({
      elements: elements as ExcalidrawElement[],
      appState: {
        ...appState,
        exportBackground: true,
        exportEmbedScene: true,
      },
      files,
      mimeType: MIME_TYPES.png,
    });

    downloadFile(blob, `excastoneboard-${boardId || 'board'}.png`);
  }, [boardId, downloadFile]);

  const copyPng = useCallback(async () => {
    if (!excalidrawApiRef.current) return;

    const elements = excalidrawApiRef.current.getSceneElements();
    const appState = excalidrawApiRef.current.getAppState();
    const files = excalidrawApiRef.current.getFiles();

    await exportToClipboard({
      elements: elements as ExcalidrawElement[],
      appState: {
        ...appState,
        exportBackground: true,
        exportEmbedScene: true,
      },
      files,
      type: 'png',
    });
  }, []);

  const exportSvg = useCallback(async () => {
    if (!excalidrawApiRef.current) return;

    const elements = excalidrawApiRef.current.getSceneElements();
    const appState = excalidrawApiRef.current.getAppState();
    const files = excalidrawApiRef.current.getFiles();

    const svgElement = await exportToSvg({
      elements: elements as ExcalidrawElement[],
      appState: {
        exportBackground: true,
        exportEmbedScene: true,
        viewBackgroundColor: appState.viewBackgroundColor,
      },
      files,
    });

    const svgBlob = new Blob([svgElement.outerHTML], { type: 'image/svg+xml' });
    downloadFile(svgBlob, `excastoneboard-${boardId || 'board'}.svg`);
  }, [boardId, downloadFile]);

  useImperativeHandle(ref, () => ({
    exportPng,
    copyPng,
    exportSvg,
  }));

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
});
