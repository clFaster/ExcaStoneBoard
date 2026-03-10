import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import type { ExcalidrawFrameHandle } from '../components/ExcalidrawFrame';
import { useBoards } from './useBoards';
import type { BoardListItem, BoardsImportResult, ExcalidrawData } from '../types/board';

type FrameExportAction = 'exportPng' | 'copyPng' | 'exportSvg';

const findBoardNameById = (items: BoardListItem[], boardId: string | null) => {
  if (!boardId) return null;
  for (const item of items) {
    if (item.type === 'board' && item.id === boardId) return item.name;
    if (item.type === 'folder') {
      const board = item.items.find((entry) => entry.id === boardId);
      if (board) return board.name;
    }
  }
  return null;
};

const collectThumbnailsFromItems = (items: BoardListItem[]) => {
  const loaded: Record<string, string> = {};
  for (const item of items) {
    if (item.type === 'board') {
      if (item.thumbnail) loaded[item.id] = item.thumbnail;
      continue;
    }

    for (const board of item.items) {
      if (board.thumbnail) loaded[board.id] = board.thumbnail;
    }
  }
  return loaded;
};

const buildBoardsExportName = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const dateStamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `excastoneboards-${dateStamp}.json`;
};

export function useAppController() {
  const {
    items,
    activeBoardId,
    loading,
    error,
    createBoard,
    renameBoard,
    deleteBoard,
    setActiveBoard,
    duplicateBoard,
    setBoardsIndex,
    saveBoardData,
    loadBoardData,
    loadBoards,
    saveBoardThumbnail,
  } = useBoards();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem('boards.sidebarCollapsed');
      return stored ? Boolean(JSON.parse(stored)) : false;
    } catch {
      return false;
    }
  });
  const [currentBoardData, setCurrentBoardData] = useState<ExcalidrawData | null>(null);
  const [boardDataLoading, setBoardDataLoading] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [boardsExportBusy, setBoardsExportBusy] = useState(false);
  const [boardsImportBusy, setBoardsImportBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const excalidrawRef = useRef<ExcalidrawFrameHandle | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const activeBoardName = useMemo(
    () => findBoardNameById(items, activeBoardId),
    [items, activeBoardId],
  );

  useEffect(() => {
    try {
      localStorage.setItem('boards.sidebarCollapsed', JSON.stringify(sidebarCollapsed));
    } catch {
      // ignore storage errors
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const loaded = collectThumbnailsFromItems(items);
    setThumbnails((prev) => ({ ...loaded, ...prev }));
  }, [items]);

  const handleThumbnailGenerated = useCallback(
    (boardId: string, dataUrl: string) => {
      setThumbnails((prev) => ({ ...prev, [boardId]: dataUrl }));
      void saveBoardThumbnail(boardId, dataUrl);
    },
    [saveBoardThumbnail],
  );

  useEffect(() => {
    let cancelled = false;
    const setIfActive = (update: () => void) => {
      if (!cancelled) update();
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

  const handleDataChange = useCallback(
    async (boardId: string, data: ExcalidrawData) => {
      await saveBoardData(boardId, data);
    },
    [saveBoardData],
  );

  const runExport = useCallback(
    async (action: () => Promise<void>) => {
      if (exportBusy) return;
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
        if (!excalidrawRef.current) throw new Error('Excalidraw not ready');
        await excalidrawRef.current[action]();
      });
    },
    [runExport],
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

  const handleExportBoards = useCallback(async () => {
    if (boardsExportBusy) return;
    setBoardsExportBusy(true);
    setSettingsError(null);

    try {
      const filePath = await save({
        defaultPath: buildBoardsExportName(),
        filters: [{ name: 'Boards export', extensions: ['json'] }],
      });

      if (!filePath) return;
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
  }, [boardsExportBusy]);

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

  const handleSelectBoard = useCallback(
    async (boardId: string) => {
      if (boardId === activeBoardId) return;
      if (excalidrawRef.current) {
        await excalidrawRef.current.flushSave();
      }
      await setActiveBoard(boardId);
    },
    [activeBoardId, setActiveBoard],
  );

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  return {
    items,
    activeBoardId,
    loading,
    error,
    createBoard,
    renameBoard,
    deleteBoard,
    duplicateBoard,
    setBoardsIndex,
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
