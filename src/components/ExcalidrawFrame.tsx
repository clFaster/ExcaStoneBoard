import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import {
  Excalidraw,
  exportToBlob,
  exportToClipboard,
  exportToSvg,
  MIME_TYPES,
} from '@excalidraw/excalidraw';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  BinaryFiles,
} from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState } from '@excalidraw/excalidraw/types';
import './ExcalidrawFrame.css';

const SAVE_DEBOUNCE_MS = 1000;
const THUMBNAIL_DEBOUNCE_MS = 5000;
const THUMBNAIL_MAX_DIM = 320;

interface SceneSnapshot {
  elements: ExcalidrawElement[];
  appState: AppState;
  files: BinaryFiles;
}

export interface ExcalidrawData {
  elements: ExcalidrawElement[];
  appState?: Partial<AppState>;
  files?: BinaryFiles;
}

interface ExcalidrawFrameProps {
  boardId: string | null;
  boardName: string | null;
  onDataChange: (boardId: string, data: ExcalidrawData) => Promise<void>;
  onThumbnailGenerated: (boardId: string, dataUrl: string) => void;
  initialData: ExcalidrawData | null;
}

export interface ExcalidrawFrameHandle {
  exportPng: () => Promise<void>;
  copyPng: () => Promise<void>;
  exportSvg: () => Promise<void>;
  flushSave: () => Promise<void>;
}

const clearTimer = (timerRef: React.MutableRefObject<number | null>) => {
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
};

const buildTimestamp = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(
    date.getHours(),
  )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
};

const sanitizeFileBaseName = (rawName: string): string => {
  const cleaned = rawName
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/\.+$/g, '')
    .slice(0, 80);
  return cleaned || 'board';
};

const buildExportFileName = (
  boardName: string | null,
  boardId: string | null,
  extension: string,
): string => {
  const base = sanitizeFileBaseName((boardName || boardId || 'board').trim() || 'board');
  return `${base}-${buildTimestamp(new Date())}.${extension}`;
};

const downloadFile = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const saveBlobWithDialog = async (blob: Blob, filename: string, extension: string) => {
  try {
    const filePath = await save({
      defaultPath: filename,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });

    if (!filePath) return;
    const arrayBuffer = await blob.arrayBuffer();
    await writeFile(filePath, new Uint8Array(arrayBuffer));
  } catch (error) {
    console.warn('Save dialog unavailable, falling back to download.', error);
    downloadFile(blob, filename);
  }
};

const getSceneSnapshot = (api: ExcalidrawImperativeAPI): SceneSnapshot => ({
  elements: api.getSceneElements() as ExcalidrawElement[],
  appState: api.getAppState(),
  files: api.getFiles(),
});

const createExportPngBlob = async (snapshot: SceneSnapshot): Promise<Blob> =>
  exportToBlob({
    elements: snapshot.elements,
    appState: {
      ...snapshot.appState,
      exportBackground: true,
      exportEmbedScene: true,
    },
    files: snapshot.files,
    mimeType: MIME_TYPES.png,
  });

const copySnapshotAsPng = async (snapshot: SceneSnapshot): Promise<void> =>
  exportToClipboard({
    elements: snapshot.elements,
    appState: {
      ...snapshot.appState,
      exportBackground: true,
      exportEmbedScene: true,
    },
    files: snapshot.files,
    type: 'png',
  });

const createExportSvgBlob = async (snapshot: SceneSnapshot): Promise<Blob> => {
  const svgElement = await exportToSvg({
    elements: snapshot.elements,
    appState: {
      exportBackground: true,
      exportEmbedScene: true,
      viewBackgroundColor: snapshot.appState.viewBackgroundColor,
    },
    files: snapshot.files,
  });

  return new Blob([svgElement.outerHTML], { type: 'image/svg+xml' });
};

const toSerializableData = (snapshot: SceneSnapshot): ExcalidrawData => ({
  elements: snapshot.elements,
  appState: {
    viewBackgroundColor: snapshot.appState.viewBackgroundColor,
    currentItemStrokeColor: snapshot.appState.currentItemStrokeColor,
    currentItemBackgroundColor: snapshot.appState.currentItemBackgroundColor,
    currentItemFillStyle: snapshot.appState.currentItemFillStyle,
    currentItemStrokeWidth: snapshot.appState.currentItemStrokeWidth,
    currentItemRoughness: snapshot.appState.currentItemRoughness,
    currentItemOpacity: snapshot.appState.currentItemOpacity,
    currentItemFontFamily: snapshot.appState.currentItemFontFamily,
    currentItemFontSize: snapshot.appState.currentItemFontSize,
    currentItemTextAlign: snapshot.appState.currentItemTextAlign,
    currentItemStartArrowhead: snapshot.appState.currentItemStartArrowhead,
    currentItemEndArrowhead: snapshot.appState.currentItemEndArrowhead,
    currentItemRoundness: snapshot.appState.currentItemRoundness,
    gridSize: snapshot.appState.gridSize,
    gridStep: snapshot.appState.gridStep,
    gridModeEnabled: snapshot.appState.gridModeEnabled,
    zenModeEnabled: snapshot.appState.zenModeEnabled,
    theme: snapshot.appState.theme,
  },
  files: snapshot.files,
});

const createThumbnailBlob = async (snapshot: SceneSnapshot): Promise<Blob> =>
  exportToBlob({
    elements: snapshot.elements,
    appState: {
      ...snapshot.appState,
      exportBackground: false,
      exportEmbedScene: false,
      exportWithDarkMode: true,
    },
    files: snapshot.files,
    mimeType: MIME_TYPES.png,
  });

const blobToThumbnailDataUrl = async (blob: Blob): Promise<string | null> =>
  new Promise((resolve) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);

    image.onload = () => {
      const scale = Math.min(1, THUMBNAIL_MAX_DIM / Math.max(image.width, image.height));
      const width = Math.round(image.width * scale);
      const height = Math.round(image.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(url);
        resolve(null);
        return;
      }

      context.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };

    image.src = url;
  });

const getInitialDataState = (initialData: ExcalidrawData | null): ExcalidrawInitialDataState => {
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

type ExcalidrawApiRef = React.MutableRefObject<ExcalidrawImperativeAPI | null>;

const useExcalidrawExports = (
  excalidrawApiRef: ExcalidrawApiRef,
  boardId: string | null,
  boardName: string | null,
) => {
  const exportPng = useCallback(async () => {
    const api = excalidrawApiRef.current;
    if (!api) {
      return;
    }

    const blob = await createExportPngBlob(getSceneSnapshot(api));
    await saveBlobWithDialog(blob, buildExportFileName(boardName, boardId, 'png'), 'png');
  }, [boardId, boardName, excalidrawApiRef]);

  const copyPng = useCallback(async () => {
    const api = excalidrawApiRef.current;
    if (!api) {
      return;
    }

    await copySnapshotAsPng(getSceneSnapshot(api));
  }, [excalidrawApiRef]);

  const exportSvg = useCallback(async () => {
    const api = excalidrawApiRef.current;
    if (!api) {
      return;
    }

    const blob = await createExportSvgBlob(getSceneSnapshot(api));
    await saveBlobWithDialog(blob, buildExportFileName(boardName, boardId, 'svg'), 'svg');
  }, [boardId, boardName, excalidrawApiRef]);

  return { exportPng, copyPng, exportSvg };
};

const useExcalidrawDataPersistence = (
  excalidrawApiRef: ExcalidrawApiRef,
  boardId: string | null,
  onDataChange: (boardId: string, data: ExcalidrawData) => Promise<void>,
) => {
  const saveTimeoutRef = useRef<number | null>(null);
  const lastSavedDataRef = useRef<string | null>(null);

  const collectData = useCallback((): ExcalidrawData | null => {
    const api = excalidrawApiRef.current;
    if (!api) {
      return null;
    }

    return toSerializableData(getSceneSnapshot(api));
  }, [excalidrawApiRef]);

  const saveData = useCallback(
    async (data: ExcalidrawData) => {
      if (!boardId) {
        return;
      }

      const dataStr = JSON.stringify(data);
      if (dataStr === lastSavedDataRef.current) {
        return;
      }

      lastSavedDataRef.current = dataStr;
      await onDataChange(boardId, data);
    },
    [boardId, onDataChange],
  );

  const flushSave = useCallback(async () => {
    clearTimer(saveTimeoutRef);
    if (!boardId) {
      return;
    }

    const data = collectData();
    if (!data) {
      return;
    }

    await saveData(data);
  }, [boardId, collectData, saveData]);

  const scheduleSave = useCallback(() => {
    clearTimer(saveTimeoutRef);
    saveTimeoutRef.current = window.setTimeout(() => {
      const data = collectData();
      if (!data) {
        return;
      }

      void saveData(data);
    }, SAVE_DEBOUNCE_MS);
  }, [collectData, saveData]);

  useEffect(
    () => () => {
      clearTimer(saveTimeoutRef);
    },
    [],
  );

  return { flushSave, scheduleSave };
};

interface ThumbnailSource {
  boardId: string;
  snapshot: SceneSnapshot;
}

const getThumbnailSource = (
  excalidrawApiRef: ExcalidrawApiRef,
  boardId: string | null,
): ThumbnailSource | null => {
  const api = excalidrawApiRef.current;
  if (!api || !boardId) {
    return null;
  }

  const snapshot = getSceneSnapshot(api);
  if (snapshot.elements.length === 0) {
    return null;
  }

  return { boardId, snapshot };
};

const useExcalidrawThumbnailPersistence = (
  excalidrawApiRef: ExcalidrawApiRef,
  boardId: string | null,
  onThumbnailGenerated: (boardId: string, dataUrl: string) => void,
) => {
  const thumbnailTimeoutRef = useRef<number | null>(null);

  const generateThumbnail = useCallback(async () => {
    const source = getThumbnailSource(excalidrawApiRef, boardId);
    if (!source) {
      return;
    }

    try {
      const blob = await createThumbnailBlob(source.snapshot);
      const dataUrl = await blobToThumbnailDataUrl(blob);
      if (dataUrl) {
        onThumbnailGenerated(source.boardId, dataUrl);
      }
    } catch (error) {
      console.error('Failed to generate thumbnail:', error);
    }
  }, [boardId, excalidrawApiRef, onThumbnailGenerated]);

  const flushThumbnail = useCallback(async () => {
    clearTimer(thumbnailTimeoutRef);
    await generateThumbnail();
  }, [generateThumbnail]);

  const scheduleThumbnail = useCallback(() => {
    clearTimer(thumbnailTimeoutRef);
    thumbnailTimeoutRef.current = window.setTimeout(() => {
      void generateThumbnail();
    }, THUMBNAIL_DEBOUNCE_MS);
  }, [generateThumbnail]);

  useEffect(
    () => () => {
      clearTimer(thumbnailTimeoutRef);
    },
    [],
  );

  return { flushThumbnail, scheduleThumbnail };
};

function EmptyBoardPlaceholder() {
  return (
    <div className="excalidraw-placeholder">
      <div className="placeholder-content">
        <svg
          width="64"
          height="64"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
        <h3>No Board Selected</h3>
        <p>Select a board from the sidebar or create a new one to get started</p>
      </div>
    </div>
  );
}

export const ExcalidrawFrame = forwardRef<ExcalidrawFrameHandle, ExcalidrawFrameProps>(
  function ExcalidrawFrame(
    { boardId, boardName, onDataChange, onThumbnailGenerated, initialData }: ExcalidrawFrameProps,
    ref,
  ) {
    const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
    const [isReady, setIsReady] = useState(false);
    const { exportPng, copyPng, exportSvg } = useExcalidrawExports(
      excalidrawApiRef,
      boardId,
      boardName,
    );
    const { flushSave, scheduleSave } = useExcalidrawDataPersistence(
      excalidrawApiRef,
      boardId,
      onDataChange,
    );
    const { flushThumbnail, scheduleThumbnail } = useExcalidrawThumbnailPersistence(
      excalidrawApiRef,
      boardId,
      onThumbnailGenerated,
    );

    const handleApiReady = useCallback((api: ExcalidrawImperativeAPI) => {
      excalidrawApiRef.current = api;
      setIsReady(true);
    }, []);

    useImperativeHandle(ref, () => ({
      exportPng,
      copyPng,
      exportSvg,
      flushSave: async () => {
        await flushSave();
        await flushThumbnail();
      },
    }));

    const handleChange = useCallback(
      (_elements: readonly ExcalidrawElement[], _appState: AppState, _files: BinaryFiles) => {
        if (!boardId || !isReady) return;
        scheduleSave();
        scheduleThumbnail();
      },
      [boardId, isReady, scheduleSave, scheduleThumbnail],
    );

    if (!boardId) {
      return <EmptyBoardPlaceholder />;
    }

    return (
      <div className="excalidraw-frame">
        <Excalidraw
          excalidrawAPI={handleApiReady}
          initialData={getInitialDataState(initialData)}
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
  },
);

export default ExcalidrawFrame;
