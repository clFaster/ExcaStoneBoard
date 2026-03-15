import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import type { ExcalidrawFrameHandle } from '../components/ExcalidrawFrame';
import { useBoards } from './useBoards';
import type { BoardListItem, BoardsImportResult, ExcalidrawData } from '../types/board';

type FrameExportAction = 'exportPng' | 'copyPng' | 'exportSvg';
type ExcalidrawRef = { current: ExcalidrawFrameHandle | null };

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'boards.sidebarCollapsed';

const flattenBoards = (items: BoardListItem[]) =>
  items.flatMap((item) => (item.type === 'board' ? [item] : item.items));

const findBoardNameById = (items: BoardListItem[], boardId: string | null) => {
  if (!boardId) {
    return null;
  }

  return flattenBoards(items).find((board) => board.id === boardId)?.name ?? null;
};

const collectThumbnailsFromItems = (items: BoardListItem[]) => {
  return flattenBoards(items).reduce<Record<string, string>>((loaded, board) => {
    if (board.thumbnail) {
      loaded[board.id] = board.thumbnail;
    }
    return loaded;
  }, {});
};

const buildBoardsExportName = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const dateStamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `excastoneboards-${dateStamp}.json`;
};

const getStoredSidebarCollapsed = () => {
  try {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    return stored ? Boolean(JSON.parse(stored)) : false;
  } catch {
    return false;
  }
};

const useSidebarCollapsed = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, JSON.stringify(sidebarCollapsed));
    } catch {
      // ignore storage errors
    }
  }, [sidebarCollapsed]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  return { sidebarCollapsed, toggleSidebar };
};

const useCurrentBoardData = (
  activeBoardId: string | null,
  loadBoardData: (boardId: string) => Promise<ExcalidrawData | null>,
) => {
  const [currentBoardData, setCurrentBoardData] = useState<ExcalidrawData | null>(null);
  const [boardDataLoading, setBoardDataLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const setIfActive = (update: () => void) => {
      if (!cancelled) {
        update();
      }
    };

    if (!activeBoardId) {
      setCurrentBoardData(null);
      setBoardDataLoading(false);
      return;
    }

    setBoardDataLoading(true);

    const loadData = async () => {
      try {
        const data = await loadBoardData(activeBoardId);
        setIfActive(() => setCurrentBoardData(data));
      } catch (e) {
        console.error('Failed to load board data:', e);
        setIfActive(() => setCurrentBoardData(null));
      } finally {
        setIfActive(() => setBoardDataLoading(false));
      }
    };

    void loadData();

    return () => {
      cancelled = true;
    };
  }, [activeBoardId, loadBoardData]);

  return { currentBoardData, boardDataLoading };
};

const useFrameExportActions = (excalidrawRef: ExcalidrawRef) => {
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const runExport = useCallback(
    async (action: () => Promise<void>) => {
      if (exportBusy) {
        return;
      }

      setExportBusy(true);
      setExportError(null);

      try {
        await action();
      } catch (e) {
        console.error('Export failed:', e);
        setExportError('Export failed. Please try again.');
      } finally {
        setExportBusy(false);
      }
    },
    [exportBusy],
  );

  const handleFrameExport = useCallback(
    async (action: FrameExportAction) => {
      await runExport(async () => {
        if (!excalidrawRef.current) {
          throw new Error('Excalidraw not ready');
        }

        await excalidrawRef.current[action]();
      });
    },
    [excalidrawRef, runExport],
  );

  const handleExportPng = useCallback(async () => {
    await handleFrameExport('exportPng');
  }, [handleFrameExport]);

  const handleCopyPng = useCallback(async () => {
    await handleFrameExport('copyPng');
  }, [handleFrameExport]);

  const handleExportSvg = useCallback(async () => {
    await handleFrameExport('exportSvg');
  }, [handleFrameExport]);

  return {
    exportBusy,
    exportError,
    handleExportPng,
    handleCopyPng,
    handleExportSvg,
  };
};

const useBoardsTransferActions = (
  excalidrawRef: ExcalidrawRef,
  loadBoards: () => Promise<void>,
) => {
  const [boardsExportBusy, setBoardsExportBusy] = useState(false);
  const [boardsImportBusy, setBoardsImportBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const handleExportBoards = useCallback(async () => {
    if (boardsExportBusy) {
      return;
    }

    setBoardsExportBusy(true);
    setSettingsError(null);

    try {
      const testExportPath = await invoke<string | null>('get_system_test_export_path');
      const filePath = testExportPath
        ? testExportPath
        : await save({
            defaultPath: buildBoardsExportName(),
            filters: [{ name: 'Boards export', extensions: ['json'] }],
          });

      if (!filePath) {
        return;
      }

      if (excalidrawRef.current) {
        await excalidrawRef.current.flushSave();
      }

      await invoke('export_boards', { filePath });
    } catch (e) {
      console.error('Boards export failed:', e);
      setSettingsError('Boards export failed. Please try again.');
    } finally {
      setBoardsExportBusy(false);
    }
  }, [boardsExportBusy, excalidrawRef]);

  const handleImportBoards = useCallback(
    async (filePath: string, selectedIndices: number[]): Promise<BoardsImportResult> => {
      if (boardsImportBusy) {
        return { imported: 0, skipped: selectedIndices.length };
      }

      setBoardsImportBusy(true);
      setSettingsError(null);

      try {
        const result = await invoke<BoardsImportResult>('import_boards', {
          filePath,
          selectedIndices,
        });
        await loadBoards();
        return result;
      } catch (e) {
        console.error('Boards import failed:', e);
        setSettingsError('Boards import failed. Please try again.');
        return { imported: 0, skipped: selectedIndices.length };
      } finally {
        setBoardsImportBusy(false);
      }
    },
    [boardsImportBusy, loadBoards],
  );

  return {
    boardsExportBusy,
    boardsImportBusy,
    settingsError,
    handleExportBoards,
    handleImportBoards,
  };
};

const useBoardPersistenceActions = (
  saveBoardData: (boardId: string, data: ExcalidrawData) => Promise<boolean>,
  saveBoardThumbnail: (boardId: string, thumbnail: string | null) => Promise<boolean>,
) => {
  const persistThumbnail = useCallback(
    (boardId: string, dataUrl: string) => {
      void saveBoardThumbnail(boardId, dataUrl);
    },
    [saveBoardThumbnail],
  );

  const handleDataChange = useCallback(
    async (boardId: string, data: ExcalidrawData) => {
      await saveBoardData(boardId, data);
    },
    [saveBoardData],
  );

  return { persistThumbnail, handleDataChange };
};

const useThumbnails = (
  items: BoardListItem[],
  persistThumbnail: (boardId: string, dataUrl: string) => void,
) => {
  const [generatedThumbnails, setGeneratedThumbnails] = useState<Record<string, string>>({});
  const thumbnails = useMemo(
    () => ({ ...collectThumbnailsFromItems(items), ...generatedThumbnails }),
    [items, generatedThumbnails],
  );

  const handleThumbnailGenerated = useCallback(
    (boardId: string, dataUrl: string) => {
      setGeneratedThumbnails((prev) => ({ ...prev, [boardId]: dataUrl }));
      persistThumbnail(boardId, dataUrl);
    },
    [persistThumbnail],
  );

  return { thumbnails, handleThumbnailGenerated };
};

const useBoardSelection = (
  activeBoardId: string | null,
  setActiveBoard: (boardId: string) => Promise<boolean>,
  excalidrawRef: ExcalidrawRef,
) => {
  return useCallback(
    async (boardId: string) => {
      if (boardId === activeBoardId) {
        return;
      }

      if (excalidrawRef.current) {
        await excalidrawRef.current.flushSave();
      }

      await setActiveBoard(boardId);
    },
    [activeBoardId, excalidrawRef, setActiveBoard],
  );
};

export function useAppController() {
  const boards = useBoards();
  const {
    items,
    activeBoardId,
    loadBoardData,
    saveBoardData,
    loadBoards,
    setActiveBoard,
    saveBoardThumbnail,
  } = boards;
  const { sidebarCollapsed, toggleSidebar } = useSidebarCollapsed();

  const excalidrawRef = useRef<ExcalidrawFrameHandle | null>(null);

  const activeBoardName = useMemo(
    () => findBoardNameById(items, activeBoardId),
    [items, activeBoardId],
  );

  const { currentBoardData, boardDataLoading } = useCurrentBoardData(activeBoardId, loadBoardData);
  const { exportBusy, exportError, handleExportPng, handleCopyPng, handleExportSvg } =
    useFrameExportActions(excalidrawRef);
  const {
    boardsExportBusy,
    boardsImportBusy,
    settingsError,
    handleExportBoards,
    handleImportBoards,
  } = useBoardsTransferActions(excalidrawRef, loadBoards);

  const { persistThumbnail, handleDataChange } = useBoardPersistenceActions(
    saveBoardData,
    saveBoardThumbnail,
  );
  const { thumbnails, handleThumbnailGenerated } = useThumbnails(items, persistThumbnail);
  const handleSelectBoard = useBoardSelection(activeBoardId, setActiveBoard, excalidrawRef);

  return {
    ...boards,
    currentBoardData,
    boardDataLoading,
    exportBusy,
    exportError,
    boardsExportBusy,
    boardsImportBusy,
    settingsError,
    excalidrawRef,
    thumbnails,
    activeBoardName,
    handleThumbnailGenerated,
    handleDataChange,
    handleExportPng,
    handleCopyPng,
    handleExportSvg,
    handleExportBoards,
    handleImportBoards,
    handleSelectBoard,
    sidebarCollapsed,
    toggleSidebar,
  };
}
