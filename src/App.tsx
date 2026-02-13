import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { BoardList } from './components/BoardList';
import { ExcalidrawFrame, ExcalidrawFrameHandle } from './components/ExcalidrawFrame';
import { useBoards } from './hooks/useBoards';
import type { BoardsImportResult, ExcalidrawData } from './types/board';
import './App.css';

function App() {
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
  } = useBoards();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentBoardData, setCurrentBoardData] = useState<ExcalidrawData | null>(null);
  const [boardDataLoading, setBoardDataLoading] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [boardsExportBusy, setBoardsExportBusy] = useState(false);
  const [boardsImportBusy, setBoardsImportBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const excalidrawRef = useRef<ExcalidrawFrameHandle | null>(null);
  const activeBoardName = (() => {
    for (const item of items) {
      if (item.type === 'board' && item.id === activeBoardId) return item.name;
      if (item.type === 'folder') {
        const board = item.items.find((entry) => entry.id === activeBoardId);
        if (board) return board.name;
      }
    }
    return null;
  })();

  // Load board data when active board changes
  useEffect(() => {
    let isActive = true;

    const loadData = async () => {
      if (activeBoardId) {
        setBoardDataLoading(true);
        try {
          const data = await loadBoardData(activeBoardId);
          if (!isActive) return;
          setCurrentBoardData(data);
        } catch (e) {
          if (!isActive) return;
          console.error('Failed to load board data:', e);
          setCurrentBoardData(null);
        } finally {
          if (isActive) {
            setBoardDataLoading(false);
          }
        }
      } else {
        setCurrentBoardData(null);
        setBoardDataLoading(false);
      }
    };
    loadData();

    return () => {
      isActive = false;
    };
  }, [activeBoardId, loadBoardData]);

  // Handle data changes from Excalidraw
  const handleDataChange = useCallback(async (boardId: string, data: ExcalidrawData) => {
    await saveBoardData(boardId, data);
  }, [saveBoardData]);

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
    [exportBusy]
  );

  const handleExportPng = useCallback(async () => {
    await runExport(async () => {
      if (!excalidrawRef.current) throw new Error('Excalidraw not ready');
      await excalidrawRef.current.exportPng();
    });
  }, [runExport]);

  const handleCopyPng = useCallback(async () => {
    await runExport(async () => {
      if (!excalidrawRef.current) throw new Error('Excalidraw not ready');
      await excalidrawRef.current.copyPng();
    });
  }, [runExport]);

  const handleExportSvg = useCallback(async () => {
    await runExport(async () => {
      if (!excalidrawRef.current) throw new Error('Excalidraw not ready');
      await excalidrawRef.current.exportSvg();
    });
  }, [runExport]);

  const handleExportBoards = useCallback(async () => {
    if (boardsExportBusy) return;
    setBoardsExportBusy(true);
    setSettingsError(null);

    try {
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, '0');
      const dateStamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const defaultName = `excastoneboards-${dateStamp}.json`;

      const filePath = await save({
        defaultPath: defaultName,
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
    [boardsImportBusy, loadBoards]
  );

  // Get the active board's collaboration link

  // Handle board selection
  const handleSelectBoard = async (boardId: string) => {
    if (boardId === activeBoardId) return;
    if (excalidrawRef.current) {
      await excalidrawRef.current.flushSave();
    }
    await setActiveBoard(boardId);
  };

  if (loading) {
    return (
      <div className="app loading-screen">
        <div className="spinner"></div>
        <p>Loading boards...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <BoardList
        items={items}
        activeBoardId={activeBoardId}
        onSelectBoard={handleSelectBoard}
        onCreateBoard={createBoard}
        onRenameBoard={renameBoard}
        onDeleteBoard={deleteBoard}
        onDuplicateBoard={duplicateBoard}
        onUpdateItems={setBoardsIndex}
        onExportPng={handleExportPng}
        onCopyPng={handleCopyPng}
        onExportSvg={handleExportSvg}
        onExportBoards={handleExportBoards}
        onImportBoards={handleImportBoards}
        exportDisabled={!activeBoardId || boardDataLoading || exportBusy}
        boardsExporting={boardsExportBusy}
        boardsImporting={boardsImportBusy}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      {activeBoardId && boardDataLoading ? (
        <div className="excalidraw-frame">
          <div className="loading-overlay">
            <div className="spinner"></div>
            <p>Loading board...</p>
          </div>
        </div>
      ) : (
        <ExcalidrawFrame
          key={activeBoardId || 'no-board'}
          boardId={activeBoardId}
          boardName={activeBoardName}
          onDataChange={handleDataChange}
          initialData={currentBoardData}
          ref={excalidrawRef}
        />
      )}
      {(error || exportError || settingsError) && (
        <div className="error-toast">
          <p>{error || exportError || settingsError}</p>
        </div>
      )}
    </div>
  );
}

export default App;
