import { lazy, Suspense } from 'react';
import { BoardList } from './components/BoardList';
import { useAppController } from './hooks/useAppController';
import './App.css';

const ExcalidrawFrame = lazy(() => import('./components/ExcalidrawFrame'));

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
      {activeBoardId && boardDataLoading ? (
        <div className="excalidraw-frame">
          <div className="loading-overlay">
            <div className="spinner"></div>
            <p>Loading board...</p>
          </div>
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="excalidraw-frame">
              <div className="loading-overlay">
                <div className="spinner"></div>
                <p>Loading editor...</p>
              </div>
            </div>
          }
        >
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
