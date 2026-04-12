import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import { BoardList } from './components/BoardList';
import { CommandPalette, type CommandPaletteItem } from './components/CommandPalette';
import type { ExcalidrawData, ExcalidrawFrameHandle } from './components/ExcalidrawFrame';
import { useAppController } from './hooks/useAppController';
import type { BoardListItem } from './types/board';
import './App.css';

const ExcalidrawFrame = lazy(() => import('./components/ExcalidrawFrame'));

type AppController = ReturnType<typeof useAppController>;
type PaletteBoardEntry = ReturnType<typeof flattenBoardsForPalette>[number];

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

const getBoardLocationDescription = (entry: PaletteBoardEntry) =>
  entry.folderName ? `Folder: ${entry.folderName}` : 'Top-level board';

const noopCommandAction = () => {};

const shouldDisableExportActions = (
  activeBoardId: string | null,
  boardDataLoading: boolean,
  exportBusy: boolean,
) => !activeBoardId || boardDataLoading || exportBusy;

const isCommandPaletteShortcut = (event: KeyboardEvent) => {
  const shortcutKey = event.key.toLowerCase();
  return event.shiftKey && shortcutKey === 'p' && (event.ctrlKey || event.metaKey);
};

const useCommandPaletteShortcut = (onTogglePalette: () => void) => {
  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (!isCommandPaletteShortcut(event)) {
        return;
      }

      event.preventDefault();
      onTogglePalette();
    };

    window.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [onTogglePalette]);
};

interface CommandPaletteCommandsConfig {
  activeBoardId: AppController['activeBoardId'];
  boardDataLoading: AppController['boardDataLoading'];
  exportBusy: AppController['exportBusy'];
  boardsExportBusy: AppController['boardsExportBusy'];
  boardsImportBusy: AppController['boardsImportBusy'];
  createBoard: AppController['createBoard'];
  renameBoard: AppController['renameBoard'];
  deleteBoard: AppController['deleteBoard'];
  duplicateBoard: AppController['duplicateBoard'];
  requestOpenSettings: () => void;
  requestOpenImportBoards: () => void;
  sidebarCollapsed: AppController['sidebarCollapsed'];
  showTimestamps: AppController['showTimestamps'];
  setShowTimestamps: AppController['setShowTimestamps'];
  toggleSidebar: AppController['toggleSidebar'];
  handleExportPng: AppController['handleExportPng'];
  handleCopyPng: AppController['handleCopyPng'];
  handleExportSvg: AppController['handleExportSvg'];
  handleExportBoards: AppController['handleExportBoards'];
  handleSelectBoard: AppController['handleSelectBoard'];
  allBoards: ReturnType<typeof flattenBoardsForPalette>;
}

interface BoardCommandGroups {
  openBoardCommands: CommandPaletteItem[];
  renameBoardCommands: CommandPaletteItem[];
  duplicateBoardCommands: CommandPaletteItem[];
  deleteBoardCommands: CommandPaletteItem[];
}

const createCreateBoardAction =
  (createBoard: AppController['createBoard']) => async (inputValue?: string) => {
    if (!inputValue) {
      return;
    }

    await createBoard(inputValue);
  };

const createRenameBoardAction =
  (renameBoard: AppController['renameBoard'], boardId: string) => async (inputValue?: string) => {
    if (!inputValue) {
      return;
    }

    await renameBoard(boardId, inputValue);
  };

const createDuplicateBoardAction =
  (duplicateBoard: AppController['duplicateBoard'], boardId: string) =>
  async (inputValue?: string) => {
    if (!inputValue) {
      return;
    }

    await duplicateBoard(boardId, inputValue);
  };

const createDeleteBoardAction =
  (deleteBoard: AppController['deleteBoard'], entry: PaletteBoardEntry) => async () => {
    const shouldDelete = window.confirm(`Delete "${entry.boardName}"?`);
    if (!shouldDelete) {
      return;
    }

    await deleteBoard(entry.boardId);
  };

const createBoardCommandGroups = (
  allBoards: PaletteBoardEntry[],
  handleSelectBoard: AppController['handleSelectBoard'],
  renameBoard: AppController['renameBoard'],
  duplicateBoard: AppController['duplicateBoard'],
  deleteBoard: AppController['deleteBoard'],
): BoardCommandGroups => ({
  openBoardCommands: allBoards.map<CommandPaletteItem>((entry) => ({
    id: `open-board-${entry.boardId}`,
    label: entry.boardName,
    description: getBoardLocationDescription(entry),
    keywords: `${entry.boardName} ${entry.folderName ?? ''}`,
    action: async () => {
      await handleSelectBoard(entry.boardId);
    },
  })),
  renameBoardCommands: allBoards.map<CommandPaletteItem>((entry) => ({
    id: `rename-board-${entry.boardId}`,
    label: entry.boardName,
    description: getBoardLocationDescription(entry),
    keywords: `rename board ${entry.boardName} ${entry.folderName ?? ''}`,
    input: {
      placeholder: `New name for "${entry.boardName}"`,
      initialValue: entry.boardName,
      submitHint: 'Press Enter to rename the board.',
    },
    action: createRenameBoardAction(renameBoard, entry.boardId),
  })),
  duplicateBoardCommands: allBoards.map<CommandPaletteItem>((entry) => ({
    id: `duplicate-board-${entry.boardId}`,
    label: entry.boardName,
    description: getBoardLocationDescription(entry),
    keywords: `duplicate board ${entry.boardName} ${entry.folderName ?? ''}`,
    input: {
      placeholder: `Copy name for "${entry.boardName}"`,
      initialValue: `${entry.boardName} (Copy)`,
      submitHint: 'Press Enter to duplicate the board.',
    },
    action: createDuplicateBoardAction(duplicateBoard, entry.boardId),
  })),
  deleteBoardCommands: allBoards.map<CommandPaletteItem>((entry) => ({
    id: `delete-board-${entry.boardId}`,
    label: entry.boardName,
    description: getBoardLocationDescription(entry),
    keywords: `delete board remove ${entry.boardName} ${entry.folderName ?? ''}`,
    action: createDeleteBoardAction(deleteBoard, entry),
  })),
});

interface BoardGroupCommandConfig {
  id: string;
  label: string;
  description: string;
  keywords: string;
  disabled: boolean;
  searchPlaceholder: string;
  emptyStateMessage: string;
  children: CommandPaletteItem[];
}

const createBoardGroupCommand = ({
  id,
  label,
  description,
  keywords,
  disabled,
  searchPlaceholder,
  emptyStateMessage,
  children,
}: BoardGroupCommandConfig): CommandPaletteItem => ({
  id,
  label,
  description,
  keywords,
  disabled,
  searchPlaceholder,
  emptyStateMessage,
  children,
  action: noopCommandAction,
});

const createBoardCommandGroupCommands = (
  hasBoards: boolean,
  boardSearchEmptyState: string,
  boardCommands: BoardCommandGroups,
) => [
  createBoardGroupCommand({
    id: 'open-board',
    label: 'Open board',
    description: hasBoards ? 'Select a board from a filterable list' : 'No boards available',
    keywords: 'open board switch select',
    disabled: !hasBoards,
    searchPlaceholder: 'Type to filter boards...',
    emptyStateMessage: boardSearchEmptyState,
    children: boardCommands.openBoardCommands,
  }),
  createBoardGroupCommand({
    id: 'rename-board',
    label: 'Rename board',
    description: hasBoards ? 'Pick a board, then enter a new name' : 'No boards available',
    keywords: 'rename board',
    disabled: !hasBoards,
    searchPlaceholder: 'Select board to rename...',
    emptyStateMessage: boardSearchEmptyState,
    children: boardCommands.renameBoardCommands,
  }),
  createBoardGroupCommand({
    id: 'duplicate-board',
    label: 'Duplicate board',
    description: hasBoards ? 'Pick a board, then name the copy' : 'No boards available',
    keywords: 'duplicate board copy',
    disabled: !hasBoards,
    searchPlaceholder: 'Select board to duplicate...',
    emptyStateMessage: boardSearchEmptyState,
    children: boardCommands.duplicateBoardCommands,
  }),
  createBoardGroupCommand({
    id: 'delete-board',
    label: 'Delete board',
    description: hasBoards ? 'Pick a board to delete' : 'No boards available',
    keywords: 'delete board remove',
    disabled: !hasBoards,
    searchPlaceholder: 'Select board to delete...',
    emptyStateMessage: boardSearchEmptyState,
    children: boardCommands.deleteBoardCommands,
  }),
];

const createCommandPaletteCommands = ({
  activeBoardId,
  boardDataLoading,
  exportBusy,
  boardsExportBusy,
  boardsImportBusy,
  createBoard,
  renameBoard,
  deleteBoard,
  duplicateBoard,
  requestOpenSettings,
  requestOpenImportBoards,
  sidebarCollapsed,
  showTimestamps,
  setShowTimestamps,
  toggleSidebar,
  handleExportPng,
  handleCopyPng,
  handleExportSvg,
  handleExportBoards,
  handleSelectBoard,
  allBoards,
}: CommandPaletteCommandsConfig): CommandPaletteItem[] => {
  const exportDisabledForCommands = shouldDisableExportActions(
    activeBoardId,
    boardDataLoading,
    exportBusy,
  );
  const hasBoards = allBoards.length > 0;
  const boardSearchEmptyState = hasBoards ? 'No matching boards.' : 'No boards available.';
  const boardCommands = createBoardCommandGroups(
    allBoards,
    handleSelectBoard,
    renameBoard,
    duplicateBoard,
    deleteBoard,
  );

  const commands: CommandPaletteItem[] = [
    {
      id: 'create-board',
      label: 'Create new board',
      description: 'Create and name a new board',
      keywords: 'new board create add',
      input: {
        placeholder: 'Board name',
        submitHint: 'Press Enter to create the board.',
      },
      action: createCreateBoardAction(createBoard),
    },
    ...createBoardCommandGroupCommands(hasBoards, boardSearchEmptyState, boardCommands),
    {
      id: 'export-boards',
      label: 'Export boards',
      description: 'Export all boards to a JSON file',
      keywords: 'boards export backup',
      disabled: boardsExportBusy,
      action: handleExportBoards,
    },
    {
      id: 'import-boards',
      label: 'Import boards',
      description: 'Import boards from a JSON file',
      keywords: 'boards import restore',
      disabled: boardsImportBusy,
      action: requestOpenImportBoards,
    },
    {
      id: 'toggle-timestamps',
      label: showTimestamps ? 'Hide sidebar timestamps' : 'Show sidebar timestamps',
      description: 'Toggle board timestamps in the sidebar',
      keywords: 'sidebar timestamps time dates',
      action: () => setShowTimestamps(!showTimestamps),
    },
    {
      id: 'open-settings',
      label: 'Open settings',
      description: 'Manage export, import, and display preferences',
      keywords: 'settings preferences options',
      action: requestOpenSettings,
    },
    {
      id: 'toggle-sidebar',
      label: sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar',
      description: 'Toggle the board sidebar visibility',
      keywords: 'sidebar collapse expand',
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

  return commands;
};

interface UseCommandPaletteControllerConfig {
  items: AppController['items'];
  activeBoardId: AppController['activeBoardId'];
  boardDataLoading: AppController['boardDataLoading'];
  exportBusy: AppController['exportBusy'];
  boardsExportBusy: AppController['boardsExportBusy'];
  boardsImportBusy: AppController['boardsImportBusy'];
  createBoard: AppController['createBoard'];
  renameBoard: AppController['renameBoard'];
  deleteBoard: AppController['deleteBoard'];
  duplicateBoard: AppController['duplicateBoard'];
  sidebarCollapsed: AppController['sidebarCollapsed'];
  showTimestamps: AppController['showTimestamps'];
  setShowTimestamps: AppController['setShowTimestamps'];
  toggleSidebar: AppController['toggleSidebar'];
  handleExportPng: AppController['handleExportPng'];
  handleCopyPng: AppController['handleCopyPng'];
  handleExportSvg: AppController['handleExportSvg'];
  handleExportBoards: AppController['handleExportBoards'];
  handleSelectBoard: AppController['handleSelectBoard'];
}

const useCommandPaletteController = ({
  items,
  activeBoardId,
  boardDataLoading,
  exportBusy,
  boardsExportBusy,
  boardsImportBusy,
  createBoard,
  renameBoard,
  deleteBoard,
  duplicateBoard,
  sidebarCollapsed,
  showTimestamps,
  setShowTimestamps,
  toggleSidebar,
  handleExportPng,
  handleCopyPng,
  handleExportSvg,
  handleExportBoards,
  handleSelectBoard,
}: UseCommandPaletteControllerConfig) => {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const allBoards = useMemo(() => flattenBoardsForPalette(items), [items]);

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false);
  }, []);

  const toggleCommandPalette = useCallback(() => {
    setCommandPaletteOpen((previous) => !previous);
  }, []);

  useCommandPaletteShortcut(toggleCommandPalette);

  const requestOpenSettings = useCallback(() => {
    window.dispatchEvent(new CustomEvent('boardlist:open-settings'));
  }, []);

  const requestOpenImportBoards = useCallback(() => {
    window.dispatchEvent(new CustomEvent('boardlist:import-boards'));
  }, []);

  const commandPaletteCommands = useMemo(
    () =>
      createCommandPaletteCommands({
        activeBoardId,
        boardDataLoading,
        exportBusy,
        boardsExportBusy,
        boardsImportBusy,
        createBoard,
        renameBoard,
        deleteBoard,
        duplicateBoard,
        requestOpenSettings,
        requestOpenImportBoards,
        sidebarCollapsed,
        showTimestamps,
        setShowTimestamps,
        toggleSidebar,
        handleExportPng,
        handleCopyPng,
        handleExportSvg,
        handleExportBoards,
        handleSelectBoard,
        allBoards,
      }),
    [
      activeBoardId,
      allBoards,
      boardDataLoading,
      boardsExportBusy,
      boardsImportBusy,
      createBoard,
      deleteBoard,
      duplicateBoard,
      exportBusy,
      handleCopyPng,
      handleExportBoards,
      handleExportPng,
      handleExportSvg,
      handleSelectBoard,
      renameBoard,
      requestOpenImportBoards,
      requestOpenSettings,
      sidebarCollapsed,
      setShowTimestamps,
      showTimestamps,
      toggleSidebar,
    ],
  );

  return { commandPaletteOpen, closeCommandPalette, commandPaletteCommands };
};

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

interface AppLayoutProps {
  items: AppController['items'];
  activeBoardId: AppController['activeBoardId'];
  thumbnails: AppController['thumbnails'];
  handleSelectBoard: AppController['handleSelectBoard'];
  createBoard: AppController['createBoard'];
  renameBoard: AppController['renameBoard'];
  deleteBoard: AppController['deleteBoard'];
  duplicateBoard: AppController['duplicateBoard'];
  setBoardsIndex: AppController['setBoardsIndex'];
  handleExportPng: AppController['handleExportPng'];
  handleCopyPng: AppController['handleCopyPng'];
  handleExportSvg: AppController['handleExportSvg'];
  handleExportBoards: AppController['handleExportBoards'];
  handleImportBoards: AppController['handleImportBoards'];
  exportDisabled: boolean;
  boardsExportBusy: AppController['boardsExportBusy'];
  boardsImportBusy: AppController['boardsImportBusy'];
  hideExportRow: AppController['hideExportRow'];
  showTimestamps: AppController['showTimestamps'];
  setHideExportRow: AppController['setHideExportRow'];
  setShowTimestamps: AppController['setShowTimestamps'];
  sidebarCollapsed: AppController['sidebarCollapsed'];
  toggleSidebar: AppController['toggleSidebar'];
  activeBoardName: AppController['activeBoardName'];
  boardDataLoading: AppController['boardDataLoading'];
  handleDataChange: AppController['handleDataChange'];
  handleThumbnailGenerated: AppController['handleThumbnailGenerated'];
  currentBoardData: AppController['currentBoardData'];
  excalidrawRef: AppController['excalidrawRef'];
  commandPaletteOpen: boolean;
  closeCommandPalette: () => void;
  commandPaletteCommands: CommandPaletteItem[];
  errorMessage: string | null;
}

function AppLayout({
  items,
  activeBoardId,
  thumbnails,
  handleSelectBoard,
  createBoard,
  renameBoard,
  deleteBoard,
  duplicateBoard,
  setBoardsIndex,
  handleExportPng,
  handleCopyPng,
  handleExportSvg,
  handleExportBoards,
  handleImportBoards,
  exportDisabled,
  boardsExportBusy,
  boardsImportBusy,
  hideExportRow,
  showTimestamps,
  setHideExportRow,
  setShowTimestamps,
  sidebarCollapsed,
  toggleSidebar,
  activeBoardName,
  boardDataLoading,
  handleDataChange,
  handleThumbnailGenerated,
  currentBoardData,
  excalidrawRef,
  commandPaletteOpen,
  closeCommandPalette,
  commandPaletteCommands,
  errorMessage,
}: AppLayoutProps) {
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
        exportDisabled={exportDisabled}
        boardsExporting={boardsExportBusy}
        boardsImporting={boardsImportBusy}
        hideExportRow={hideExportRow}
        onHideExportRowChange={setHideExportRow}
        showTimestamps={showTimestamps}
        onShowTimestampsChange={setShowTimestamps}
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
    hideExportRow,
    showTimestamps,
    setHideExportRow,
    setShowTimestamps,
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

  const { commandPaletteOpen, closeCommandPalette, commandPaletteCommands } =
    useCommandPaletteController({
      items,
      activeBoardId,
      boardDataLoading,
      exportBusy,
      boardsExportBusy,
      boardsImportBusy,
      createBoard,
      renameBoard,
      deleteBoard,
      duplicateBoard,
      sidebarCollapsed,
      showTimestamps,
      setShowTimestamps,
      toggleSidebar,
      handleExportPng,
      handleCopyPng,
      handleExportSvg,
      handleExportBoards,
      handleSelectBoard,
    });

  const exportDisabled = useMemo(
    () => shouldDisableExportActions(activeBoardId, boardDataLoading, exportBusy),
    [activeBoardId, boardDataLoading, exportBusy],
  );

  if (loading) {
    return <FullScreenLoading message="Loading boards..." />;
  }

  const errorMessage = error ?? exportError ?? settingsError;

  return (
    <AppLayout
      items={items}
      activeBoardId={activeBoardId}
      thumbnails={thumbnails}
      handleSelectBoard={handleSelectBoard}
      createBoard={createBoard}
      renameBoard={renameBoard}
      deleteBoard={deleteBoard}
      duplicateBoard={duplicateBoard}
      setBoardsIndex={setBoardsIndex}
      handleExportPng={handleExportPng}
      handleCopyPng={handleCopyPng}
      handleExportSvg={handleExportSvg}
      handleExportBoards={handleExportBoards}
      handleImportBoards={handleImportBoards}
      exportDisabled={exportDisabled}
      boardsExportBusy={boardsExportBusy}
      boardsImportBusy={boardsImportBusy}
      hideExportRow={hideExportRow}
      showTimestamps={showTimestamps}
      setHideExportRow={setHideExportRow}
      setShowTimestamps={setShowTimestamps}
      sidebarCollapsed={sidebarCollapsed}
      toggleSidebar={toggleSidebar}
      activeBoardName={activeBoardName}
      boardDataLoading={boardDataLoading}
      handleDataChange={handleDataChange}
      handleThumbnailGenerated={handleThumbnailGenerated}
      currentBoardData={currentBoardData}
      excalidrawRef={excalidrawRef}
      commandPaletteOpen={commandPaletteOpen}
      closeCommandPalette={closeCommandPalette}
      commandPaletteCommands={commandPaletteCommands}
      errorMessage={errorMessage}
    />
  );
}

export default App;
