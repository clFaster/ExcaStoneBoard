import { useState, useEffect, useCallback, useRef } from 'react';
import { BoardList } from './components/BoardList';
import { ExcalidrawFrame, ExcalidrawFrameHandle } from './components/ExcalidrawFrame';
import { useBoards } from './hooks/useBoards';
import type { ExcalidrawData } from './types/board';
import './App.css';

function App() {
  const {
    boards,
    activeBoardId,
    loading,
    error,
    createBoard,
    renameBoard,
    deleteBoard,
    setActiveBoard,
    duplicateBoard,
    saveBoardData,
    loadBoardData,
  } = useBoards();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentBoardData, setCurrentBoardData] = useState<ExcalidrawData | null>(null);
  const [boardDataLoading, setBoardDataLoading] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const excalidrawRef = useRef<ExcalidrawFrameHandle | null>(null);
  const activeBoardName = boards.find((board) => board.id === activeBoardId)?.name || null;

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
  const handleDataChange = useCallback(async (data: ExcalidrawData) => {
    if (activeBoardId) {
      await saveBoardData(activeBoardId, data);
    }
  }, [activeBoardId, saveBoardData]);

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

  // Get the active board's collaboration link

  // Handle board selection
  const handleSelectBoard = async (boardId: string) => {
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
        boards={boards}
        activeBoardId={activeBoardId}
        onSelectBoard={handleSelectBoard}
        onCreateBoard={createBoard}
        onRenameBoard={renameBoard}
        onDeleteBoard={deleteBoard}
        onDuplicateBoard={duplicateBoard}
        onExportPng={handleExportPng}
        onCopyPng={handleCopyPng}
        onExportSvg={handleExportSvg}
        exportDisabled={!activeBoardId || boardDataLoading || exportBusy}
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
      {(error || exportError) && (
        <div className="error-toast">
          <p>{error || exportError}</p>
        </div>
      )}
    </div>
  );
}

export default App;
