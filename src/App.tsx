import { lazy, Suspense } from 'react';
import type { RefObject } from 'react';
import { BoardList } from './components/BoardList';
import type { ExcalidrawData, ExcalidrawFrameHandle } from './components/ExcalidrawFrame';
import { useAppController } from './hooks/useAppController';
import './App.css';

const ExcalidrawFrame = lazy(() => import('./components/ExcalidrawFrame'));

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
      <AppErrorToast message={errorMessage} />
    </div>
  );
}

export default App;
