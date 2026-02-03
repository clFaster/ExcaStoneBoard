import React, { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragCancelEvent,
  DragEndEvent,
  DragMoveEvent,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  pointerWithin,
  ClientRect,
  UniqueIdentifier,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { Board, BoardListItem } from '../types/board';
import './BoardList.css';

interface BoardListProps {
  items: BoardListItem[];
  activeBoardId: string | null;
  onSelectBoard: (boardId: string) => void;
  onCreateBoard: (name: string) => void;
  onRenameBoard: (boardId: string, newName: string) => void;
  onDeleteBoard: (boardId: string) => void;
  onDuplicateBoard: (boardId: string, newName: string) => void;
  onUpdateItems: (items: BoardListItem[]) => void;
  onExportPng: () => void;
  onCopyPng: () => void;
  onExportSvg: () => void;
  exportDisabled: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

interface BoardRowProps {
  dragId: string;
  className: string;
  dropMode: 'before' | 'after' | 'folder' | null;
  itemType: 'board' | 'folder';
  inFolder: boolean;
  parentFolderId?: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function BoardRow({
  dragId,
  className,
  dropMode,
  itemType,
  inFolder,
  parentFolderId,
  disabled,
  onClick,
  children,
}: BoardRowProps) {
  const { attributes, listeners, setNodeRef: setDraggableRef, transform, isDragging } = useDraggable({
    id: dragId,
    disabled,
  });
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: dragId,
    data: { inFolder, itemType, parentFolderId },
  });

  const setNodeRef = (node: HTMLElement | null) => {
    setDraggableRef(node);
    setDroppableRef(node);
  };

  const style = transform
    ? { transform: `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` }
    : undefined;
  const dropClass = dropMode ? `drag-${dropMode}` : '';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${className} ${dropClass} ${isDragging ? 'is-dragging' : ''}`}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

export function BoardList({
  items,
  activeBoardId,
  onSelectBoard,
  onCreateBoard,
  onRenameBoard,
  onDeleteBoard,
  onDuplicateBoard,
  onUpdateItems,
  onExportPng,
  onCopyPng,
  onExportSvg,
  exportDisabled,
  isCollapsed,
  onToggleCollapse,
}: BoardListProps) {
  const [newBoardName, setNewBoardName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [showMenu, setShowMenu] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [showFolderMenu, setShowFolderMenu] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [dragOverTarget, setDragOverTarget] = useState<{
    id: string;
    mode: 'before' | 'after' | 'folder';
  } | null>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!showMenu && !showFolderMenu) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.board-menu') || target.closest('.menu-btn')) return;
      setShowMenu(null);
      setShowFolderMenu(null);
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu, showFolderMenu]);

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

  const handleStartFolderEdit = (folderId: string, folderName: string) => {
    setEditingFolderId(folderId);
    setEditFolderName(folderName);
    setShowFolderMenu(null);
  };

  const handleSaveEdit = (boardId: string) => {
    if (editName.trim()) {
      onRenameBoard(boardId, editName.trim());
    }
    setEditingId(null);
    setEditName('');
  };

  const handleSaveFolderEdit = (folderId: string) => {
    if (editFolderName.trim()) {
      const nextItems = items.map((item) =>
        item.type === 'folder' && item.id === folderId
          ? {
            ...item,
            name: editFolderName.trim(),
          }
          : item
      );
      onUpdateItems(nextItems);
    }
    setEditingFolderId(null);
    setEditFolderName('');
  };

  const handleDuplicate = (board: Board) => {
    onDuplicateBoard(board.id, `${board.name} (Copy)`);
    setShowMenu(null);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const parseDragId = (id: UniqueIdentifier) => {
    const raw = String(id);
    if (raw.startsWith('folder:')) {
      return { type: 'folder' as const, id: raw.slice('folder:'.length), raw };
    }
    return { type: 'board' as const, id: raw, raw };
  };

  const toggleFolderCollapsed = (folderId: string) => {
    setCollapsedFolders((prev) => ({
      ...prev,
      [folderId]: !prev[folderId],
    }));
  };

  const isFolderCollapsed = (folderId: string) => Boolean(collapsedFolders[folderId]);

  type FlattenedBoard = { board: Board; folderId?: string };

  const flattenedBoards = useMemo<FlattenedBoard[]>(
    () =>
      items.flatMap<FlattenedBoard>((item) =>
        item.type === 'folder'
          ? item.items.map((board) => ({ board, folderId: item.id }))
          : [{ board: item }]
      ),
    [items]
  );

  const stripBoardType = (board: Board): Board => {
    const maybeTyped = board as Board & { type?: string };
    if (maybeTyped.type) {
      const { type: _type, ...rest } = maybeTyped;
      return rest;
    }
    return board;
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: 50, tolerance: 6 },
    })
  );

  const getDropModeFromRects = (
    activeRect: ClientRect | null | undefined,
    overRect: ClientRect | null | undefined,
    allowFolderDrop: boolean
  ) => {
    if (!activeRect || !overRect) return 'after';
    const activeCenterY = activeRect.top + activeRect.height / 2;
    const ratio = (activeCenterY - overRect.top) / overRect.height;

    if (!allowFolderDrop) {
      return ratio < 0.5 ? 'before' : 'after';
    }

    if (ratio < 0.25) return 'before';
    if (ratio > 0.75) return 'after';
    return 'folder';
  };

  const updateDropTarget = (event: DragMoveEvent | DragOverEvent) => {
    const over = event.over;
    if (!over) {
      setDragOverTarget(null);
      return;
    }
    const active = parseDragId(event.active.id);
    let overItem = parseDragId(over.id);
    const overInFolder = Boolean(over.data.current?.inFolder);
    const parentFolderId = over.data.current?.parentFolderId as string | undefined;
    if (active.type === 'folder' && overInFolder && parentFolderId) {
      overItem = { type: 'folder' as const, id: parentFolderId, raw: `folder:${parentFolderId}` };
    }
    if (overItem.raw === active.raw) {
      setDragOverTarget(null);
      return;
    }
    const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
    const allowFolderDrop = active.type === 'board' && !overInFolder;
    const mode = getDropModeFromRects(
      activeRect as ClientRect | null | undefined,
      over.rect as ClientRect | null | undefined,
      allowFolderDrop
    );
    setDragOverTarget({ id: overItem.raw, mode });
  };

  const handleDragStart = (event: DragStartEvent) => {
    setDragOverTarget(null);
    const active = parseDragId(event.active.id);
    if (active.type === 'board') {
      onSelectBoard(active.id);
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    updateDropTarget(event);
  };

  const handleDragOver = (event: DragOverEvent) => {
    updateDropTarget(event);
  };

  const handleDragCancel = (_event: DragCancelEvent) => {
    setDragOverTarget(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const over = event.over;
    const active = parseDragId(event.active.id);
    const overItem = over ? parseDragId(over.id) : null;

    if (!overItem || overItem.raw === active.raw) {
      setDragOverTarget(null);
      return;
    }

    const overInFolder = Boolean(over?.data.current?.inFolder);
    const parentFolderId = over?.data.current?.parentFolderId as string | undefined;
    const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
    const allowFolderDrop = active.type === 'board' && !overInFolder;
    const resolvedMode = getDropModeFromRects(
      activeRect as ClientRect | null | undefined,
      over?.rect as ClientRect | null | undefined,
      allowFolderDrop
    );
    const mode = dragOverTarget?.id === overItem.raw ? dragOverTarget.mode : resolvedMode;

    if (active.type === 'folder') {
      const target = overInFolder && parentFolderId ? { type: 'folder' as const, id: parentFolderId } : overItem;
      if (target.type === 'folder' && target.id === active.id) {
        setDragOverTarget(null);
        return;
      }
      moveFolderRelative(active.id, target, mode === 'folder' ? 'after' : mode);
      setDragOverTarget(null);
      return;
    }

    if (overItem.type === 'folder') {
      if (mode === 'folder') {
        moveBoardIntoFolder(active.id, overItem.id);
      } else {
        moveBoardRelativeToFolder(active.id, overItem.id, mode);
      }
      setDragOverTarget(null);
      return;
    }

    if (mode === 'folder' && !overInFolder) {
      createFolderFromDrop(active.id, overItem.id);
    } else {
      moveBoardRelative(active.id, overItem.id, mode === 'folder' ? 'after' : mode);
    }

    setDragOverTarget(null);
  };

  const cleanupFolders = (nextItems: BoardListItem[]) => {
    const seen = new Set<string>();
    const normalized: BoardListItem[] = [];

    for (const item of nextItems) {
      if (item.type === 'board') {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        normalized.push(item);
        continue;
      }

      const remaining = item.items.filter((board) => !seen.has(board.id));
      if (remaining.length === 0) continue;
      if (remaining.length === 1) {
        const board = { ...remaining[0], type: 'board' as const };
        seen.add(board.id);
        normalized.push(board);
        continue;
      }

      remaining.forEach((board) => seen.add(board.id));
      normalized.push({ ...item, items: remaining });
    }

    return normalized;
  };

  useEffect(() => {
    const normalized = cleanupFolders(items);
    if (JSON.stringify(normalized) !== JSON.stringify(items)) {
      onUpdateItems(normalized);
    }
  }, [items, onUpdateItems]);

  const moveBoardRelative = (sourceId: string, targetId: string, position: 'before' | 'after') => {
    if (sourceId === targetId) return;
    const sourceBoard = flattenedBoards.find((entry) => entry.board.id === sourceId)?.board;
    if (!sourceBoard) return;

    const filteredItems = items
      .map((item) => {
        if (item.type === 'folder') {
          const remaining = item.items.filter((board) => board.id !== sourceId);
          if (remaining.length === 0) return null;
          return {
            ...item,
            items: remaining,
          };
        }
        if (item.id === sourceId) return null;
        return item;
      })
      .filter((item): item is BoardListItem => Boolean(item));

    const targetLocation = (() => {
      for (let index = 0; index < filteredItems.length; index += 1) {
        const item = filteredItems[index];
        if (item.type === 'board') {
          if (item.id === targetId) return { type: 'board' as const, index };
        } else {
          const innerIndex = item.items.findIndex((board) => board.id === targetId);
          if (innerIndex !== -1) {
            return { type: 'folder' as const, index, innerIndex };
          }
        }
      }
      return null;
    })();

    if (!targetLocation) return;

    if (targetLocation.type === 'board') {
      const insertIndex = targetLocation.index + (position === 'after' ? 1 : 0);
      const nextItems = [...filteredItems];
      nextItems.splice(insertIndex, 0, { ...sourceBoard, type: 'board' });
      onUpdateItems(cleanupFolders(nextItems));
      return;
    }

    const folderItem = filteredItems[targetLocation.index];
    if (!folderItem || folderItem.type !== 'folder') return;
    const nextItems = [...filteredItems];
    const nextFolderItems = [...folderItem.items];
    const insertIndex = targetLocation.innerIndex + (position === 'after' ? 1 : 0);
    nextFolderItems.splice(insertIndex, 0, stripBoardType(sourceBoard));
    nextItems[targetLocation.index] = { ...folderItem, items: nextFolderItems };
    onUpdateItems(cleanupFolders(nextItems));
  };

  const moveBoardIntoFolder = (sourceId: string, folderId: string) => {
    if (!sourceId || !folderId) return;
    const sourceBoard = flattenedBoards.find((entry) => entry.board.id === sourceId)?.board;
    if (!sourceBoard) return;

    const filteredItems = items
      .map((item) => {
        if (item.type === 'folder') {
          const remaining = item.items.filter((board) => board.id !== sourceId);
          if (item.id === folderId) {
            return {
              ...item,
              items: remaining,
            };
          }
          if (remaining.length === 0) return null;
          return {
            ...item,
            items: remaining,
          };
        }
        if (item.id === sourceId) return null;
        return item;
      })
      .filter((item): item is BoardListItem => Boolean(item));

    const nextItems = filteredItems.map((item) => {
      if (item.type === 'folder' && item.id === folderId) {
        return {
          ...item,
          items: [...item.items, stripBoardType(sourceBoard)],
        };
      }
      return item;
    });

    onUpdateItems(cleanupFolders(nextItems));
  };

  const moveBoardRelativeToFolder = (sourceId: string, folderId: string, position: 'before' | 'after') => {
    if (!sourceId || !folderId) return;
    const sourceBoard = flattenedBoards.find((entry) => entry.board.id === sourceId)?.board;
    if (!sourceBoard) return;

    const filteredItems = items
      .map((item) => {
        if (item.type === 'folder') {
          const remaining = item.items.filter((board) => board.id !== sourceId);
          if (remaining.length === 0) return null;
          return {
            ...item,
            items: remaining,
          };
        }
        if (item.id === sourceId) return null;
        return item;
      })
      .filter((item): item is BoardListItem => Boolean(item));

    const targetIndex = filteredItems.findIndex((item) => item.type === 'folder' && item.id === folderId);
    if (targetIndex === -1) return;

    const insertIndex = targetIndex + (position === 'after' ? 1 : 0);
    const nextItems = [...filteredItems];
    nextItems.splice(insertIndex, 0, { ...sourceBoard, type: 'board' });
    onUpdateItems(cleanupFolders(nextItems));
  };

  const moveFolderRelative = (
    sourceFolderId: string,
    target: { type: 'board' | 'folder'; id: string },
    position: 'before' | 'after'
  ) => {
    if (!sourceFolderId) return;
    const sourceIndex = items.findIndex((item) => item.type === 'folder' && item.id === sourceFolderId);
    if (sourceIndex === -1) return;
    const sourceItem = items[sourceIndex];
    if (sourceItem.type !== 'folder') return;

    const remaining = items.filter((_, index) => index !== sourceIndex);
    const targetIndex = remaining.findIndex((item) =>
      item.type === 'folder' ? item.id === target.id : item.id === target.id
    );
    if (targetIndex === -1) return;

    const insertIndex = targetIndex + (position === 'after' ? 1 : 0);
    remaining.splice(insertIndex, 0, sourceItem);
    onUpdateItems(remaining);
  };

  const createFolderFromDrop = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const sourceBoard = flattenedBoards.find((entry) => entry.board.id === sourceId)?.board;
    const targetBoard = flattenedBoards.find((entry) => entry.board.id === targetId)?.board;
    if (!sourceBoard || !targetBoard) return;

    const insertIndex = (() => {
      let index = 0;
      for (const item of items) {
        const isTargetContainer =
          item.type === 'board'
            ? item.id === targetId
            : item.items.some((board) => board.id === targetId);
        if (isTargetContainer) return index;
        if (item.type === 'board') {
          if (item.id !== sourceId && item.id !== targetId) {
            index += 1;
          }
        } else {
          const remaining = item.items.filter((board) => board.id !== sourceId && board.id !== targetId);
          if (remaining.length > 0) {
            index += 1;
          }
        }
      }
      return index;
    })();

    const cleanedItems = items
      .map((item) => {
        if (item.type === 'folder') {
          const remaining = item.items.filter((board) => board.id !== sourceId && board.id !== targetId);
          if (remaining.length === 0) return null;
          return {
            ...item,
            items: remaining,
          };
        }
        if (item.type === 'board') {
          if (item.id === sourceId || item.id === targetId) return null;
        }
        return item;
      })
      .filter((item): item is BoardListItem => Boolean(item));

    const folder = {
      type: 'folder' as const,
      id: globalThis.crypto?.randomUUID?.() ?? `folder-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: targetBoard.name,
      items: [stripBoardType(targetBoard), stripBoardType(sourceBoard)],
    };

    const nextItems = [...cleanedItems];
    nextItems.splice(insertIndex, 0, folder);
    onUpdateItems(cleanupFolders(nextItems));
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
          {flattenedBoards.map(({ board }) => (
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
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragOver={handleDragOver}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
      collisionDetection={pointerWithin}
      modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
    >
      <div className="board-list">
        <div className="board-list-header">
          <h2>Boards</h2>
          <button className="toggle-btn" onClick={onToggleCollapse} title="Collapse sidebar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>

      <div className="board-export-actions">
        <button
          type="button"
          className="export-btn"
          onClick={onExportPng}
          disabled={exportDisabled}
          title="Export PNG"
          aria-label="Export PNG"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </button>
        <button
          type="button"
          className="export-btn"
          onClick={onCopyPng}
          disabled={exportDisabled}
          title="Copy PNG"
          aria-label="Copy PNG"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        </button>
        <button
          type="button"
          className="export-btn"
          onClick={onExportSvg}
          disabled={exportDisabled}
          title="Export SVG"
          aria-label="Export SVG"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4z" />
            <polyline points="9 9 12 12 15 9" />
            <line x1="12" y1="12" x2="12" y2="17" />
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
        {items.length === 0 ? (
          <div className="no-boards">
            <p>No boards yet</p>
            <p className="hint">Create a new board to get started</p>
          </div>
        ) : (
          items.map((item) =>
            item.type === 'folder' ? (
              <div key={item.id} className="board-folder">
                <BoardRow
                  dragId={`folder:${item.id}`}
                  itemType="folder"
                  inFolder={false}
                  className="board-folder-header"
                  dropMode={dragOverTarget?.id === `folder:${item.id}` ? dragOverTarget.mode : null}
                  disabled={editingFolderId === item.id}
                  onClick={() => toggleFolderCollapsed(item.id)}
                >
                  {editingFolderId === item.id ? (
                    <div className="folder-edit" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="text"
                        value={editFolderName}
                        onChange={(e) => setEditFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveFolderEdit(item.id);
                          if (e.key === 'Escape') setEditingFolderId(null);
                        }}
                        autoFocus
                        className="edit-input"
                      />
                      <button onClick={() => handleSaveFolderEdit(item.id)} className="save-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`folder-toggle ${isFolderCollapsed(item.id) ? 'collapsed' : ''}`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFolderCollapsed(item.id);
                        }}
                        aria-label={isFolderCollapsed(item.id) ? 'Expand folder' : 'Collapse folder'}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9 18l6-6-6-6" />
                        </svg>
                      </button>
                      <span className="drag-handle" aria-hidden="true">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                          <circle cx="8" cy="6" r="1.5" />
                          <circle cx="16" cy="6" r="1.5" />
                          <circle cx="8" cy="12" r="1.5" />
                          <circle cx="16" cy="12" r="1.5" />
                          <circle cx="8" cy="18" r="1.5" />
                          <circle cx="16" cy="18" r="1.5" />
                        </svg>
                      </span>
                      <span className="folder-name">{item.name}</span>
                      <span className="folder-count">{item.items.length}</span>
                      <button
                        className="menu-btn"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowMenu(null);
                          setShowFolderMenu(showFolderMenu === item.id ? null : item.id);
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="1" />
                          <circle cx="12" cy="5" r="1" />
                          <circle cx="12" cy="19" r="1" />
                        </svg>
                      </button>
                      {showFolderMenu === item.id && (
                        <div className="board-menu" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => handleStartFolderEdit(item.id, item.name)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                            Rename Folder
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </BoardRow>
                {!isFolderCollapsed(item.id) &&
                  item.items.map((board) => (
                    <BoardRow
                      key={board.id}
                      dragId={board.id}
                      itemType="board"
                      inFolder
                      parentFolderId={item.id}
                      className={`board-item ${board.id === activeBoardId ? 'active' : ''}`}
                      dropMode={dragOverTarget?.id === board.id ? dragOverTarget.mode : null}
                      disabled={editingId === board.id}
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
                          <div className="board-header-row">
                            <div className="board-title-row">
                              <span className="drag-handle" aria-hidden="true">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                  <circle cx="8" cy="6" r="1.5" />
                                  <circle cx="16" cy="6" r="1.5" />
                                  <circle cx="8" cy="12" r="1.5" />
                                  <circle cx="16" cy="12" r="1.5" />
                                  <circle cx="8" cy="18" r="1.5" />
                                  <circle cx="16" cy="18" r="1.5" />
                                </svg>
                              </span>
                              <span className="board-name">{board.name}</span>
                            </div>
                            <span className="board-date">{formatDate(board.updated_at)}</span>
                          </div>
                        </div>
                        <div className="board-actions">
                          <button
                            className="menu-btn"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowFolderMenu(null);
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
                  </BoardRow>
                ))}
              </div>
            ) : (
              <BoardRow
                key={item.id}
                dragId={item.id}
                itemType="board"
                className={`board-item ${item.id === activeBoardId ? 'active' : ''}`}
                dropMode={dragOverTarget?.id === item.id ? dragOverTarget.mode : null}
                inFolder={false}
                disabled={editingId === item.id}
                onClick={() => editingId !== item.id && onSelectBoard(item.id)}
              >
                {editingId === item.id ? (
                  <div className="board-edit" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEdit(item.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      className="edit-input"
                    />
                    <button onClick={() => handleSaveEdit(item.id)} className="save-btn">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="board-info">
                      <div className="board-header-row">
                        <div className="board-title-row">
                          <span className="drag-handle" aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <circle cx="8" cy="6" r="1.5" />
                              <circle cx="16" cy="6" r="1.5" />
                              <circle cx="8" cy="12" r="1.5" />
                              <circle cx="16" cy="12" r="1.5" />
                              <circle cx="8" cy="18" r="1.5" />
                              <circle cx="16" cy="18" r="1.5" />
                            </svg>
                          </span>
                          <span className="board-name">{item.name}</span>
                        </div>
                        <span className="board-date">{formatDate(item.updated_at)}</span>
                      </div>
                    </div>
                    <div className="board-actions">
                      <button
                        className="menu-btn"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowFolderMenu(null);
                          setShowMenu(showMenu === item.id ? null : item.id);
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="1" />
                          <circle cx="12" cy="5" r="1" />
                          <circle cx="12" cy="19" r="1" />
                        </svg>
                      </button>
                      {showMenu === item.id && (
                        <div className="board-menu" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => handleStartEdit(item)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                            Rename
                          </button>
                          <button onClick={() => handleDuplicate(item)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                            Duplicate
                          </button>
                          <button
                            className="danger"
                            onClick={() => {
                              if (confirm(`Delete "${item.name}"?`)) {
                                onDeleteBoard(item.id);
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
              </BoardRow>
            )
          )
        )}
      </div>

      <div className="board-links">
        <div className="board-links-title">Star on GitHub</div>
        <a
          className="board-link"
          href="https://github.com/clFaster/ExcaStoneBoard"
          target="_blank"
          rel="noreferrer"
        >
          <span className="board-link-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.1.68-.22.68-.48v-1.7c-2.76.6-3.35-1.18-3.35-1.18-.45-1.14-1.1-1.44-1.1-1.44-.9-.61.07-.6.07-.6 1 .07 1.53 1.02 1.53 1.02.88 1.52 2.3 1.08 2.86.82.09-.65.34-1.08.62-1.33-2.2-.25-4.52-1.1-4.52-4.9 0-1.08.38-1.96 1.02-2.65-.1-.25-.44-1.27.1-2.65 0 0 .83-.27 2.73 1.01A9.45 9.45 0 0 1 12 6.8a9.5 9.5 0 0 1 2.49.33c1.9-1.28 2.72-1.01 2.72-1.01.55 1.38.21 2.4.1 2.65.63.69 1.02 1.57 1.02 2.65 0 3.8-2.32 4.65-4.53 4.9.35.3.66.9.66 1.82v2.7c0 .26.18.58.69.48A10 10 0 0 0 12 2z" />
            </svg>
          </span>
          <span className="board-link-text">ExcaStoneBoard</span>
        </a>
        <a
          className="board-link"
          href="https://github.com/excalidraw/excalidraw"
          target="_blank"
          rel="noreferrer"
        >
          <span className="board-link-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M12 2a10 10 0 0 0-3.16 19.49c.5.1.68-.22.68-.48v-1.7c-2.76.6-3.35-1.18-3.35-1.18-.45-1.14-1.1-1.44-1.1-1.44-.9-.61.07-.6.07-.6 1 .07 1.53 1.02 1.53 1.02.88 1.52 2.3 1.08 2.86.82.09-.65.34-1.08.62-1.33-2.2-.25-4.52-1.1-4.52-4.9 0-1.08.38-1.96 1.02-2.65-.1-.25-.44-1.27.1-2.65 0 0 .83-.27 2.73 1.01A9.45 9.45 0 0 1 12 6.8a9.5 9.5 0 0 1 2.49.33c1.9-1.28 2.72-1.01 2.72-1.01.55 1.38.21 2.4.1 2.65.63.69 1.02 1.57 1.02 2.65 0 3.8-2.32 4.65-4.53 4.9.35.3.66.9.66 1.82v2.7c0 .26.18.58.69.48A10 10 0 0 0 12 2z" />
            </svg>
          </span>
          <span className="board-link-text">Excalidraw</span>
        </a>
      </div>

      </div>
    </DndContext>
  );
}
