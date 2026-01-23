import React, { useState } from 'react';
import { Board } from '../types/board';
import './BoardList.css';

interface BoardListProps {
  boards: Board[];
  activeBoardId: string | null;
  onSelectBoard: (boardId: string) => void;
  onCreateBoard: (name: string) => void;
  onRenameBoard: (boardId: string, newName: string) => void;
  onDeleteBoard: (boardId: string) => void;
  onDuplicateBoard: (boardId: string, newName: string) => void;
  onSetCollaborationLink: (boardId: string, link: string | null) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function BoardList({
  boards,
  activeBoardId,
  onSelectBoard,
  onCreateBoard,
  onRenameBoard,
  onDeleteBoard,
  onDuplicateBoard,
  onSetCollaborationLink,
  isCollapsed,
  onToggleCollapse,
}: BoardListProps) {
  const [newBoardName, setNewBoardName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showMenu, setShowMenu] = useState<string | null>(null);
  const [showCollabModal, setShowCollabModal] = useState<string | null>(null);
  const [collabLink, setCollabLink] = useState('');

  const handleCreateBoard = (e: React.FormEvent) => {
    e.preventDefault();
    if (newBoardName.trim()) {
      onCreateBoard(newBoardName.trim());
      setNewBoardName('');
    }
  };

  const handleStartEdit = (board: Board) => {
    setEditingId(board.id);
    setEditName(board.name);
    setShowMenu(null);
  };

  const handleSaveEdit = (boardId: string) => {
    if (editName.trim()) {
      onRenameBoard(boardId, editName.trim());
    }
    setEditingId(null);
    setEditName('');
  };

  const handleDuplicate = (board: Board) => {
    onDuplicateBoard(board.id, `${board.name} (Copy)`);
    setShowMenu(null);
  };

  const handleOpenCollabModal = (board: Board) => {
    setShowCollabModal(board.id);
    setCollabLink(board.collaboration_link || '');
    setShowMenu(null);
  };

  const handleSaveCollabLink = (boardId: string) => {
    onSetCollaborationLink(boardId, collabLink.trim() || null);
    setShowCollabModal(null);
    setCollabLink('');
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    });
  };

  if (isCollapsed) {
    return (
      <div className="board-list collapsed">
        <button className="toggle-btn" onClick={onToggleCollapse} title="Expand sidebar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <div className="collapsed-boards">
          {boards.map((board) => (
            <button
              key={board.id}
              className={`collapsed-board-btn ${board.id === activeBoardId ? 'active' : ''}`}
              onClick={() => onSelectBoard(board.id)}
              title={board.name}
            >
              {board.name.charAt(0).toUpperCase()}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="board-list">
      <div className="board-list-header">
        <h2>Boards</h2>
        <button className="toggle-btn" onClick={onToggleCollapse} title="Collapse sidebar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      <form className="new-board-form" onSubmit={handleCreateBoard}>
        <input
          type="text"
          value={newBoardName}
          onChange={(e) => setNewBoardName(e.target.value)}
          placeholder="New board name..."
          className="new-board-input"
        />
        <button type="submit" className="new-board-btn" disabled={!newBoardName.trim()}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </form>

      <div className="boards-scroll">
        {boards.length === 0 ? (
          <div className="no-boards">
            <p>No boards yet</p>
            <p className="hint">Create a new board to get started</p>
          </div>
        ) : (
          boards.map((board) => (
            <div
              key={board.id}
              className={`board-item ${board.id === activeBoardId ? 'active' : ''}`}
              onClick={() => editingId !== board.id && onSelectBoard(board.id)}
            >
              {editingId === board.id ? (
                <div className="board-edit" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveEdit(board.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    autoFocus
                    className="edit-input"
                  />
                  <button onClick={() => handleSaveEdit(board.id)} className="save-btn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  </button>
                </div>
              ) : (
                <>
                  <div className="board-info">
                    <span className="board-name">{board.name}</span>
                    <span className="board-date">{formatDate(board.updated_at)}</span>
                    {board.collaboration_link && (
                      <span className="collab-indicator" title="Has collaboration link">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                      </span>
                    )}
                  </div>
                  <div className="board-actions">
                    <button
                      className="menu-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(showMenu === board.id ? null : board.id);
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="1" />
                        <circle cx="12" cy="5" r="1" />
                        <circle cx="12" cy="19" r="1" />
                      </svg>
                    </button>
                    {showMenu === board.id && (
                      <div className="board-menu" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => handleStartEdit(board)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                          Rename
                        </button>
                        <button onClick={() => handleDuplicate(board)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                          </svg>
                          Duplicate
                        </button>
                        <button onClick={() => handleOpenCollabModal(board)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                          </svg>
                          Collaboration Link
                        </button>
                        <div className="menu-divider" />
                        <button
                          className="danger"
                          onClick={() => {
                            if (confirm(`Delete "${board.name}"?`)) {
                              onDeleteBoard(board.id);
                            }
                            setShowMenu(null);
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {showCollabModal && (
        <div className="modal-overlay" onClick={() => setShowCollabModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Collaboration Link</h3>
            <p className="modal-hint">
              Paste an Excalidraw collaboration room link to quickly access shared sessions.
            </p>
            <input
              type="text"
              value={collabLink}
              onChange={(e) => setCollabLink(e.target.value)}
              placeholder="https://excalidraw.com/#room=..."
              className="collab-input"
            />
            <div className="modal-actions">
              <button className="cancel-btn" onClick={() => setShowCollabModal(null)}>
                Cancel
              </button>
              <button
                className="save-btn"
                onClick={() => handleSaveCollabLink(showCollabModal)}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
