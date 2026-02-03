import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowUpRightFromSquare,
  faCheck,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faClone,
  faCopy,
  faEllipsisVertical,
  faFileCode,
  faFileImage,
  faGripVertical,
  faPen,
  faPlus,
  faStar,
  faTrash,
} from '@fortawesome/free-solid-svg-icons';
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
  DraggableAttributes,
  DraggableSyntheticListeners,
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
  dragHandleMode?: 'row' | 'handle';
  lockTransform?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

type DragHandleContextValue = {
  attributes: DraggableAttributes;
  listeners?: DraggableSyntheticListeners;
  setActivatorNodeRef?: (node: HTMLElement | null) => void;
};

const DragHandleContext = React.createContext<DragHandleContextValue | null>(null);

function DragHandle({ className, children, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  const classes = className ? `drag-handle ${className}` : 'drag-handle';

  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}

function DragActivator({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  const ctx = useContext(DragHandleContext);
  const classes = className ?? '';

  if (!ctx) {
    return (
      <div className={classes} {...rest}>
        {children}
      </div>
    );
  }

  return (
    <div
      ref={ctx.setActivatorNodeRef}
      className={classes}
      {...ctx.attributes}
      {...ctx.listeners}
      {...rest}
    >
      {children}
    </div>
  );
}

function BoardRow({
  dragId,
  className,
  dropMode,
  itemType,
  inFolder,
  parentFolderId,
  dragHandleMode = 'handle',
  lockTransform,
  disabled,
  onClick,
  children,
}: BoardRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    setActivatorNodeRef,
    transform,
    isDragging,
  } = useDraggable({
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

  const style = transform && !lockTransform
    ? { transform: `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` }
    : undefined;
  const dropClass = dropMode ? `drag-${dropMode}` : '';

  const handleContext = dragHandleMode === 'handle' ? { attributes, listeners, setActivatorNodeRef } : null;
  const rowProps = dragHandleMode === 'row' ? { ...attributes, ...listeners } : {};

  return (
    <DragHandleContext.Provider value={handleContext}>
      <div
        ref={setNodeRef}
        style={style}
        className={`${className} ${dropClass} ${isDragging ? 'is-dragging' : ''}`}
        onClick={onClick}
        {...rowProps}
      >
        {children}
      </div>
    </DragHandleContext.Provider>
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
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [activeMenu, setActiveMenu] = useState<{
    type: 'board' | 'folder';
    id: string;
    anchorRect: DOMRect;
  } | null>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem('boards.collapsedFolders');
      return stored ? (JSON.parse(stored) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  const [dragOverTarget, setDragOverTarget] = useState<{
    id: string;
    mode: 'before' | 'after' | 'folder';
  } | null>(null);

  const boardsScrollRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!activeMenu) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.board-menu-portal') || target.closest('.menu-btn')) return;
      setActiveMenu(null);
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [activeMenu]);

  useEffect(() => {
    if (!activeMenu) return undefined;
    const closeMenu = () => setActiveMenu(null);
    const scrollNode = boardsScrollRef.current;
    scrollNode?.addEventListener('scroll', closeMenu, { passive: true });
    window.addEventListener('resize', closeMenu);
    return () => {
      scrollNode?.removeEventListener('scroll', closeMenu);
      window.removeEventListener('resize', closeMenu);
    };
  }, [activeMenu]);

  useLayoutEffect(() => {
    if (!activeMenu || !menuRef.current) return;
    const menuRect = menuRef.current.getBoundingClientRect();
    const padding = 8;
    let left = activeMenu.anchorRect.right - menuRect.width;
    if (left < padding) left = padding;
    if (left + menuRect.width > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - menuRect.width - padding);
    }
    let top = activeMenu.anchorRect.bottom + 6;
    if (top + menuRect.height > window.innerHeight - padding) {
      top = Math.max(padding, activeMenu.anchorRect.top - menuRect.height - 6);
    }
    setMenuStyle({ top, left });
  }, [activeMenu]);

  useEffect(() => {
    try {
      localStorage.setItem('boards.collapsedFolders', JSON.stringify(collapsedFolders));
    } catch {
      // ignore storage errors
    }
  }, [collapsedFolders]);

  useEffect(() => {
    const folderIds = new Set(items.filter((item) => item.type === 'folder').map((item) => item.id));
    setCollapsedFolders((prev) => {
      const next: Record<string, boolean> = {};
      for (const [id, value] of Object.entries(prev)) {
        if (folderIds.has(id)) {
          next[id] = value;
        }
      }
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [items]);

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
    setActiveMenu(null);
  };

  const handleStartFolderEdit = (folderId: string, folderName: string) => {
    setEditingFolderId(folderId);
    setEditFolderName(folderName);
    setActiveMenu(null);
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
    setActiveMenu(null);
  };

  const handleDelete = (board: Board) => {
    if (confirm(`Delete "${board.name}"?`)) {
      onDeleteBoard(board.id);
    }
    setActiveMenu(null);
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

  const getBoardById = (boardId: string) => flattenedBoards.find((entry) => entry.board.id === boardId)?.board;

  const getFolderById = (folderId: string) =>
    items.find((item) => item.type === 'folder' && item.id === folderId) || null;

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>, type: 'board' | 'folder', id: string) => {
    event.stopPropagation();
    const anchorRect = event.currentTarget.getBoundingClientRect();
    setActiveMenu((prev) => {
      if (prev && prev.type === type && prev.id === id) return null;
      return { type, id, anchorRect };
    });
  };

  const dragDisabled = Boolean(activeMenu || editingId || editingFolderId);

  const menuContent = (() => {
    if (!activeMenu) return null;
    if (activeMenu.type === 'board') {
      const board = getBoardById(activeMenu.id);
      if (!board) return null;
      return (
        <>
          <button onClick={() => handleStartEdit(board)}>
            <FontAwesomeIcon icon={faPen} />
            Rename
          </button>
          <button onClick={() => handleDuplicate(board)}>
            <FontAwesomeIcon icon={faClone} />
            Duplicate
          </button>
          <button className="danger" onClick={() => handleDelete(board)}>
            <FontAwesomeIcon icon={faTrash} />
            Delete
          </button>
        </>
      );
    }

    const folder = getFolderById(activeMenu.id);
    if (!folder || folder.type !== 'folder') return null;
    return (
      <>
        <button onClick={() => handleStartFolderEdit(folder.id, folder.name)}>
          <FontAwesomeIcon icon={faPen} />
          Rename Folder
        </button>
      </>
    );
  })();

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
          <FontAwesomeIcon icon={faChevronRight} />
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
            <FontAwesomeIcon icon={faChevronLeft} />
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
          <FontAwesomeIcon icon={faFileImage} />
        </button>
        <button
          type="button"
          className="export-btn"
          onClick={onCopyPng}
          disabled={exportDisabled}
          title="Copy PNG"
          aria-label="Copy PNG"
        >
          <FontAwesomeIcon icon={faCopy} />
        </button>
        <button
          type="button"
          className="export-btn"
          onClick={onExportSvg}
          disabled={exportDisabled}
          title="Export SVG"
          aria-label="Export SVG"
        >
          <FontAwesomeIcon icon={faFileCode} />
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
          <FontAwesomeIcon icon={faPlus} />
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
              <BoardRow
                key={item.id}
                dragId={`folder:${item.id}`}
                itemType="folder"
                inFolder={false}
                className={`board-folder ${
                  dragOverTarget?.id === `folder:${item.id}` ? `drag-${dragOverTarget.mode}` : ''
                }`}
                dropMode={dragOverTarget?.id === `folder:${item.id}` ? dragOverTarget.mode : null}
                dragHandleMode="handle"
                disabled={dragDisabled || editingFolderId === item.id}
                onClick={() => undefined}
              >
                {editingFolderId === item.id ? (
                  <div className="board-folder-header">
                    <div
                      className="folder-edit"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                    >
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
                        onPointerDown={(e) => e.stopPropagation()}
                      />
                      <button onClick={() => handleSaveFolderEdit(item.id)} className="save-btn">
                        <FontAwesomeIcon icon={faCheck} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <DragActivator
                    className="board-folder-header"
                    onClick={() => toggleFolderCollapsed(item.id)}
                  >
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
                      <FontAwesomeIcon icon={isFolderCollapsed(item.id) ? faChevronRight : faChevronDown} />
                    </button>
                    <DragHandle aria-hidden="true">
                      <FontAwesomeIcon icon={faGripVertical} />
                    </DragHandle>
                    <span className="folder-name">{item.name}</span>
                    <span className="folder-count">{item.items.length}</span>
                    <button
                      className="menu-btn"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => openMenu(e, 'folder', item.id)}
                    >
                      <FontAwesomeIcon icon={faEllipsisVertical} />
                    </button>
                  </DragActivator>
                )}
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
                      disabled={dragDisabled || editingId === board.id}
                      dragHandleMode="row"
                      onClick={() => editingId !== board.id && onSelectBoard(board.id)}
                    >
                    {editingId === board.id ? (
                      <div
                        className="board-edit"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                      >
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
                          onPointerDown={(e) => e.stopPropagation()}
                        />
                        <button onClick={() => handleSaveEdit(board.id)} className="save-btn">
                          <FontAwesomeIcon icon={faCheck} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="board-info">
                          <DragHandle aria-hidden="true">
                            <FontAwesomeIcon icon={faGripVertical} />
                          </DragHandle>
                          <div className="board-text">
                            <span className="board-name">{board.name}</span>
                            <span className="board-date">{formatDate(board.updated_at)}</span>
                          </div>
                        </div>
                        <div className="board-actions">
                          <button
                            className="menu-btn"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => openMenu(e, 'board', board.id)}
                          >
                            <FontAwesomeIcon icon={faEllipsisVertical} />
                          </button>
                        </div>
                      </>
                    )}
                  </BoardRow>
                ))}
              </BoardRow>
            ) : (
              <BoardRow
                key={item.id}
                dragId={item.id}
                itemType="board"
                className={`board-item ${item.id === activeBoardId ? 'active' : ''}`}
                dropMode={dragOverTarget?.id === item.id ? dragOverTarget.mode : null}
                inFolder={false}
                disabled={dragDisabled || editingId === item.id}
                dragHandleMode="row"
                onClick={() => editingId !== item.id && onSelectBoard(item.id)}
              >
                {editingId === item.id ? (
                  <div
                    className="board-edit"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
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
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    <button onClick={() => handleSaveEdit(item.id)} className="save-btn">
                      <FontAwesomeIcon icon={faCheck} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="board-info">
                      <DragHandle aria-hidden="true">
                        <FontAwesomeIcon icon={faGripVertical} />
                      </DragHandle>
                      <div className="board-text">
                        <span className="board-name">{item.name}</span>
                        <span className="board-date">{formatDate(item.updated_at)}</span>
                      </div>
                    </div>
                    <div className="board-actions">
                      <button
                        className="menu-btn"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => openMenu(e, 'board', item.id)}
                      >
                        <FontAwesomeIcon icon={faEllipsisVertical} />
                      </button>
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
            <FontAwesomeIcon icon={faStar} />
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
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </span>
          <span className="board-link-text">Excalidraw</span>
        </a>
      </div>

      </div>
      {activeMenu && menuContent
        ? createPortal(
            <div
              ref={menuRef}
              className="board-menu board-menu-portal"
              style={{ position: 'fixed', ...menuStyle }}
            >
              {menuContent}
            </div>,
            document.body
          )
        : null}
    </DndContext>
  );
}
