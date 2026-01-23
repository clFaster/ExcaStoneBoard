import { useState, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { BoardList } from './components/BoardList';
import { ExcalidrawFrame } from './components/ExcalidrawFrame';
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
    setCollaborationLink,
    saveBoardData,
    loadBoardData,
  } = useBoards();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [currentBoardData, setCurrentBoardData] = useState<ExcalidrawData | null>(null);
  const [deepLinkUrl, setDeepLinkUrl] = useState<string | null>(null);
  const [showDeepLinkModal, setShowDeepLinkModal] = useState(false);

  // Listen for deep link events
  useEffect(() => {
    const unlisten = listen<string>('deep-link-received', (event) => {
      const url = event.payload;
      console.log('Deep link received:', url);
      
      // Parse the URL to extract excalidraw link
      // Format: drawmesomething://open?url=<encoded-url>
      // Or: excalidraw://<path>
      try {
        let excalidrawUrl: string | null = null;
        
        if (url.startsWith('drawmesomething://')) {
          const parsed = new URL(url);
          excalidrawUrl = parsed.searchParams.get('url');
        } else if (url.startsWith('excalidraw://')) {
          // Convert excalidraw:// to https://excalidraw.com/
          excalidrawUrl = url.replace('excalidraw://', 'https://excalidraw.com/');
        }
        
        if (excalidrawUrl) {
          setDeepLinkUrl(excalidrawUrl);
          setShowDeepLinkModal(true);
        }
      } catch (e) {
        console.error('Failed to parse deep link:', e);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Handle deep link - create new board or open in existing
  const handleDeepLinkNewBoard = async () => {
    if (!deepLinkUrl) return;
    
    // Extract a name from the URL (use room ID or default name)
    let name = 'Shared Drawing';
    if (deepLinkUrl.includes('#room=')) {
      const match = deepLinkUrl.match(/#room=([^,&]+)/);
      if (match) {
        name = `Collab: ${match[1].substring(0, 8)}...`;
      }
    }
    
    const board = await createBoard(name);
    if (board) {
      await setCollaborationLink(board.id, deepLinkUrl);
      await setActiveBoard(board.id);
    }
    
    setShowDeepLinkModal(false);
    setDeepLinkUrl(null);
  };

  const handleDeepLinkCurrentBoard = async () => {
    if (!deepLinkUrl || !activeBoardId) return;
    
    await setCollaborationLink(activeBoardId, deepLinkUrl);
    // Force reload by clearing and resetting
    setCurrentBoardData(null);
    setTimeout(async () => {
      const data = await loadBoardData(activeBoardId);
      setCurrentBoardData(data);
    }, 100);
    
    setShowDeepLinkModal(false);
    setDeepLinkUrl(null);
  };

  // Load board data when active board changes
  useEffect(() => {
    const loadData = async () => {
      if (activeBoardId) {
        const data = await loadBoardData(activeBoardId);
        setCurrentBoardData(data);
      } else {
        setCurrentBoardData(null);
      }
    };
    loadData();
  }, [activeBoardId, loadBoardData]);

  // Handle data changes from Excalidraw
  const handleDataChange = useCallback(async (data: ExcalidrawData) => {
    if (activeBoardId) {
      await saveBoardData(activeBoardId, data);
    }
  }, [activeBoardId, saveBoardData]);

  // Get the active board's collaboration link
  const activeBoard = boards.find((b) => b.id === activeBoardId);
  const collaborationLink = activeBoard?.collaboration_link || null;

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
        onSetCollaborationLink={setCollaborationLink}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <ExcalidrawFrame
        key={activeBoardId || 'no-board'}
        boardId={activeBoardId}
        collaborationLink={collaborationLink}
        onDataChange={handleDataChange}
        initialData={currentBoardData}
      />
      {error && (
        <div className="error-toast">
          <p>{error}</p>
        </div>
      )}
      
      {/* Deep Link Modal */}
      {showDeepLinkModal && deepLinkUrl && (
        <div className="modal-overlay" onClick={() => setShowDeepLinkModal(false)}>
          <div className="deep-link-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Open Excalidraw Link</h3>
            <p className="modal-url">{deepLinkUrl}</p>
            <p className="modal-hint">How would you like to open this link?</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowDeepLinkModal(false)}>
                Cancel
              </button>
              {activeBoardId && (
                <button className="btn-secondary" onClick={handleDeepLinkCurrentBoard}>
                  Open in Current Board
                </button>
              )}
              <button className="btn-primary" onClick={handleDeepLinkNewBoard}>
                Create New Board
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
