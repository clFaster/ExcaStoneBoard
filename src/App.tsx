import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import { BoardList } from './components/BoardList';
import { CommandPalette, type CommandPaletteItem } from './components/CommandPalette';
import type { ExcalidrawData, ExcalidrawFrameHandle } from './components/ExcalidrawFrame';
import type { BoardListItem } from './types/board';
import { useAppController } from './hooks/useAppController';
import './App.css';

const ExcalidrawFrame = lazy(() => import('./components/ExcalidrawFrame'));

const flattenBoardsForPalette = (items: BoardListItem[]) =>
  items.flatMap((item) =>
    item.type === 'board'
      ? [{ boardId: item.id, boardName: item.name, folderName: null as string | null }]
      : item.items.map((board) => ({
          boardId: board.id,
          boardName: board.name,
          folderName: item.name,
        })),
  );

function FullScreenLoading({ message }: { message: string }) {
  return (
    <div className="app loading-screen">
      <div className="spinner"></div>
      <p>{message}</p>
    </div>
  );
}

function ExcalidrawLoadingOverlay({ message }: { message: string }) {
  return (
    <div className="excalidraw-frame">
      <div className="loading-overlay">
        <div className="spinner"></div>
        <p>{message}</p>
      </div>
    </div>
  );
}

function AppErrorToast({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <div className="error-toast">
      <p>{message}</p>
    </div>
  );
}

interface EditorPanelProps {
  activeBoardId: string | null;
  boardDataLoading: boolean;
  activeBoardName: string | null;
  handleDataChange: (boardId: string, data: ExcalidrawData) => Promise<void>;
  handleThumbnailGenerated: (boardId: string, dataUrl: string) => void;
  currentBoardData: ExcalidrawData | null;
  excalidrawRef: RefObject<ExcalidrawFrameHandle | null>;
}

function EditorPanel({
  activeBoardId,
  boardDataLoading,
  activeBoardName,
  handleDataChange,
  handleThumbnailGenerated,
  currentBoardData,
  excalidrawRef,
}: EditorPanelProps) {
  if (activeBoardId && boardDataLoading) {
    return <ExcalidrawLoadingOverlay message="Loading board..." />;
  }

  return (
    <Suspense fallback={<ExcalidrawLoadingOverlay message="Loading editor..." />}>
      <ExcalidrawFrame
        key={activeBoardId || 'no-board'}
        boardId={activeBoardId}
        boardName={activeBoardName}
        onDataChange={handleDataChange}
        onThumbnailGenerated={handleThumbnailGenerated}
        initialData={currentBoardData}
        ref={excalidrawRef}
      />
    </Suspense>
  );
}

function App() {
  const {
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
  } = useAppController();

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const allBoards = useMemo(() => flattenBoardsForPalette(items), [items]);

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
  }, []);

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, []);

  const requestOpenSettings = useCallback(() => {
    window.dispatchEvent(new CustomEvent('boardlist:open-settings'));
  }, []);

  const commandPaletteCommands = useMemo<CommandPaletteItem[]>(() => {
    const exportDisabledForCommands = !activeBoardId || boardDataLoading || exportBusy;

    const commands: CommandPaletteItem[] = [
      {
        id: 'create-board',
        label: 'Create new board',
        description: 'Create and name a new board',
        keywords: 'new board create add',
        shortcut: 'N',
        input: {
          placeholder: 'Board name',
          submitHint: 'Press Enter to create the board.',
        },
        action: async (inputValue) => {
          if (!inputValue) {
            return;
          }
          await createBoard(inputValue);
        },
      },
      {
        id: 'open-settings',
        label: 'Open settings',
        description: 'Manage export, import, and display preferences',
        keywords: 'settings preferences options',
        shortcut: ',',
        action: requestOpenSettings,
      },
      {
        id: 'toggle-sidebar',
        label: sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
        description: 'Toggle the board sidebar visibility',
        keywords: 'sidebar collapse expand',
        shortcut: 'B',
        action: toggleSidebar,
      },
      {
        id: 'export-png',
        label: 'Export active board as PNG',
        description: 'Save a PNG image from the active board',
        keywords: 'export png image',
        disabled: exportDisabledForCommands,
        action: handleExportPng,
      },
      {
        id: 'copy-png',
        label: 'Copy active board as PNG',
        description: 'Copy a PNG image from the active board',
        keywords: 'copy png image clipboard',
        disabled: exportDisabledForCommands,
        action: handleCopyPng,
      },
      {
        id: 'export-svg',
        label: 'Export active board as SVG',
        description: 'Save a vector SVG from the active board',
        keywords: 'export svg vector',
        disabled: exportDisabledForCommands,
        action: handleExportSvg,
      },
    ];

    const openBoardCommands = allBoards.map<CommandPaletteItem>((entry) => ({
      id: `open-board-${entry.boardId}`,
      label: `Open board: ${entry.boardName}`,
      description: entry.folderName ? `Folder: ${entry.folderName}` : 'Top-level board',
      keywords: `open board ${entry.boardName} ${entry.folderName ?? ''}`,
      action: async () => {
        await handleSelectBoard(entry.boardId);
      },
    }));

    return [...commands, ...openBoardCommands];
  }, [
    activeBoardId,
    allBoards,
    boardDataLoading,
    createBoard,
    exportBusy,
    handleCopyPng,
    handleExportPng,
    handleExportSvg,
    handleSelectBoard,
    requestOpenSettings,
    sidebarCollapsed,
    toggleSidebar,
  ]);

  if (loading) {
    return <FullScreenLoading message="Loading boards..." />;
  }

  const errorMessage = error ?? exportError ?? settingsError;

  return (
    <div className="app">
      <BoardList
        items={items}
        activeBoardId={activeBoardId}
        thumbnails={thumbnails}
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
        onToggleCollapse={toggleSidebar}
      />
      <EditorPanel
        activeBoardId={activeBoardId}
        boardDataLoading={boardDataLoading}
        activeBoardName={activeBoardName}
        handleDataChange={handleDataChange}
        handleThumbnailGenerated={handleThumbnailGenerated}
        currentBoardData={currentBoardData}
        excalidrawRef={excalidrawRef}
      />
      {commandPaletteOpen ? (
        <CommandPalette onClose={closeCommandPalette} commands={commandPaletteCommands} />
      ) : null}
      <AppErrorToast message={errorMessage} />
    </div>
  );
}

export default App;
