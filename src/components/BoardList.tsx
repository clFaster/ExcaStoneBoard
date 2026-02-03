import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { confirm } from '@tauri-apps/plugin-dialog';
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
  DragEndEvent,
  DragMoveEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  UniqueIdentifier,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  MeasuringStrategy,
} from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToWindowEdges } from '@dnd-kit/modifiers';
import { Board, BoardListItem, BoardFolder } from '../types/board';
import './BoardList.css';

// =============================================================================
// Types
// =============================================================================

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

type DropPosition = 'before' | 'after' | 'inside';

interface DragState {
  activeId: UniqueIdentifier | null;
  activeType: 'board' | 'folder' | null;
  overId: UniqueIdentifier | null;
  overType: 'board' | 'folder' | null;
  dropPosition: DropPosition | null;
}

// =============================================================================
// Utility Functions
// =============================================================================

const parseDragId = (id: UniqueIdentifier): { type: 'board' | 'folder'; id: string } => {
  const raw = String(id);
  if (raw.startsWith('folder:')) {
    return { type: 'folder', id: raw.slice('folder:'.length) };
  }
  return { type: 'board', id: raw };
};

const makeDragId = (type: 'board' | 'folder', id: string): string =>
  type === 'folder' ? `folder:${id}` : id;

const stripBoardType = (board: Board): Board => {
  const maybeTyped = board as Board & { type?: string };
  if (maybeTyped.type) {
    const { type: _type, ...rest } = maybeTyped;
    return rest;
  }
  return board;
};

const generateFolderId = () =>
  globalThis.crypto?.randomUUID?.() ?? `folder-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// =============================================================================
// Draggable/Droppable Item Components
// =============================================================================

interface DraggableBoardItemProps {
  board: Board;
  isActive: boolean;
  isEditing: boolean;
  editName: string;
  onEditNameChange: (name: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onSelect: () => void;
  onOpenMenu: (e: React.MouseEvent<HTMLButtonElement>) => void;
  formatDate: (date: string) => string;
  disabled?: boolean;
  inFolder?: boolean;
  parentFolderId?: string;
  dropPosition?: DropPosition | null;
  isDragSource?: boolean;
}

function DraggableBoardItem({
  board,
  isActive,
  isEditing,
  editName,
  onEditNameChange,
  onSaveEdit,
  onCancelEdit,
  onSelect,
  onOpenMenu,
  formatDate,
  disabled,
  inFolder,
  parentFolderId,
  dropPosition,
  isDragSource,
}: DraggableBoardItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    isDragging,
  } = useDraggable({
    id: board.id,
    disabled,
    data: { type: 'board', inFolder, parentFolderId },
  });

  const { setNodeRef: setDroppableRef } = useDroppable({
    id: board.id,
    data: { type: 'board', inFolder, parentFolderId },
  });

  const setNodeRef = (node: HTMLElement | null) => {
    setDraggableRef(node);
    setDroppableRef(node);
  };

  const dropClass = dropPosition ? `drop-${dropPosition}` : '';
  const dragClass = isDragging || isDragSource ? 'is-dragging' : '';

  return (
    <div
      ref={setNodeRef}
      className={`board-item ${isActive ? 'active' : ''} ${dragClass} ${dropClass}`}
      onClick={() => !isEditing && onSelect()}
      {...attributes}
      {...listeners}
    >
      {isEditing ? (
        <div
          className="board-edit"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit();
              if (e.key === 'Escape') onCancelEdit();
            }}
            autoFocus
            className="edit-input"
            onPointerDown={(e) => e.stopPropagation()}
          />
          <button onClick={onSaveEdit} className="save-btn">
            <FontAwesomeIcon icon={faCheck} />
          </button>
        </div>
      ) : (
        <>
          <div className="board-info">
            <span className="drag-handle" aria-hidden="true">
              <FontAwesomeIcon icon={faGripVertical} />
            </span>
            <div className="board-text">
              <span className="board-name">{board.name}</span>
              <span className="board-date">{formatDate(board.updated_at)}</span>
            </div>
          </div>
          <div className="board-actions">
            <button
              className="menu-btn"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onOpenMenu}
            >
              <FontAwesomeIcon icon={faEllipsisVertical} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface DraggableFolderItemProps {
  folder: BoardFolder;
  isCollapsed: boolean;
  isEditing: boolean;
  editName: string;
  onEditNameChange: (name: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onToggleCollapse: () => void;
  onOpenMenu: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  dropPosition?: DropPosition | null;
  isDragSource?: boolean;
  children: React.ReactNode;
}

function DraggableFolderItem({
  folder,
  isCollapsed,
  isEditing,
  editName,
  onEditNameChange,
  onSaveEdit,
  onCancelEdit,
  onToggleCollapse,
  onOpenMenu,
  disabled,
  dropPosition,
  isDragSource,
  children,
}: DraggableFolderItemProps) {
  const dragId = makeDragId('folder', folder.id);

  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    isDragging,
  } = useDraggable({
    id: dragId,
    disabled,
    data: { type: 'folder' },
  });

  const { setNodeRef: setDroppableRef } = useDroppable({
    id: dragId,
    data: { type: 'folder' },
  });

  const setNodeRef = (node: HTMLElement | null) => {
    setDraggableRef(node);
    setDroppableRef(node);
  };

  const dropClass = dropPosition ? `drop-${dropPosition}` : '';
  const dragClass = isDragging || isDragSource ? 'is-dragging' : '';

  return (
    <div
      ref={setNodeRef}
      className={`board-folder ${dragClass} ${dropClass}`}
    >
      {isEditing ? (
        <div className="board-folder-header">
          <div
            className="folder-edit"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveEdit();
                if (e.key === 'Escape') onCancelEdit();
              }}
              autoFocus
              className="edit-input"
              onPointerDown={(e) => e.stopPropagation()}
            />
            <button onClick={onSaveEdit} className="save-btn">
              <FontAwesomeIcon icon={faCheck} />
            </button>
          </div>
        </div>
      ) : (
        <div className="board-folder-header" {...attributes} {...listeners}>
          <button
            type="button"
            className={`folder-toggle ${isCollapsed ? 'collapsed' : ''}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            aria-label={isCollapsed ? 'Expand folder' : 'Collapse folder'}
          >
            <FontAwesomeIcon icon={isCollapsed ? faChevronRight : faChevronDown} />
          </button>
          <span className="drag-handle" aria-hidden="true">
            <FontAwesomeIcon icon={faGripVertical} />
          </span>
          <span className="folder-name">{folder.name}</span>
          <span className="folder-count">{folder.items.length}</span>
          <button
            className="menu-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onOpenMenu}
          >
            <FontAwesomeIcon icon={faEllipsisVertical} />
          </button>
        </div>
      )}
      {!isCollapsed && <div className="folder-items">{children}</div>}
    </div>
  );
}

// =============================================================================
// Drag Overlay Components (Ghost preview while dragging)
// =============================================================================

interface BoardOverlayProps {
  board: Board;
  formatDate: (date: string) => string;
}

function BoardOverlay({ board, formatDate }: BoardOverlayProps) {
  return (
    <div className="board-item drag-overlay">
      <div className="board-info">
        <span className="drag-handle visible" aria-hidden="true">
          <FontAwesomeIcon icon={faGripVertical} />
        </span>
        <div className="board-text">
          <span className="board-name">{board.name}</span>
          <span className="board-date">{formatDate(board.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}

interface FolderOverlayProps {
  folder: BoardFolder;
}

function FolderOverlay({ folder }: FolderOverlayProps) {
  return (
    <div className="board-folder drag-overlay">
      <div className="board-folder-header">
        <button type="button" className="folder-toggle">
          <FontAwesomeIcon icon={faChevronDown} />
        </button>
        <span className="drag-handle visible" aria-hidden="true">
          <FontAwesomeIcon icon={faGripVertical} />
        </span>
        <span className="folder-name">{folder.name}</span>
        <span className="folder-count">{folder.items.length}</span>
      </div>
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

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
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
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

  const [dragState, setDragState] = useState<DragState>({
    activeId: null,
    activeType: null,
    overId: null,
    overType: null,
    dropPosition: null,
  });

  const boardsScrollRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // ---------------------------------------------------------------------------
  // Memoized Data
  // ---------------------------------------------------------------------------
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

  const getBoardById = (boardId: string) =>
    flattenedBoards.find((entry) => entry.board.id === boardId)?.board;

  const getFolderById = (folderId: string) =>
    items.find((item) => item.type === 'folder' && item.id === folderId) as BoardFolder | undefined;

  // ---------------------------------------------------------------------------
  // Effects
  // ---------------------------------------------------------------------------
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

  // Cleanup folders (convert single-item folders to boards, remove empty ones)
  useEffect(() => {
    const normalized = cleanupFolders(items);
    if (JSON.stringify(normalized) !== JSON.stringify(items)) {
      onUpdateItems(normalized);
    }
  }, [items, onUpdateItems]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
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
          ? { ...item, name: editFolderName.trim() }
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

  const handleDelete = async (board: Board) => {
    const message = `Delete "${board.name}"?`;
    let shouldDelete = false;
    try {
      shouldDelete = await confirm(message, { title: 'Delete board', kind: 'warning' });
    } catch {
      shouldDelete = window.confirm(message);
    }
    if (shouldDelete) {
      await onDeleteBoard(board.id);
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

  const toggleFolderCollapsed = (folderId: string) => {
    setCollapsedFolders((prev) => ({ ...prev, [folderId]: !prev[folderId] }));
  };

  const isFolderCollapsed = (folderId: string) => Boolean(collapsedFolders[folderId]);

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>, type: 'board' | 'folder', id: string) => {
    event.stopPropagation();
    const anchorRect = event.currentTarget.getBoundingClientRect();
    setActiveMenu((prev) => {
      if (prev && prev.type === type && prev.id === id) return null;
      return { type, id, anchorRect };
    });
  };

  const dragDisabled = Boolean(activeMenu || editingId || editingFolderId);

  // ---------------------------------------------------------------------------
  // Helper Functions
  // ---------------------------------------------------------------------------
  const cleanupFolders = (nextItems: BoardListItem[]): BoardListItem[] => {
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

  const removeBoardFromItems = (boardId: string, sourceItems: BoardListItem[]): BoardListItem[] => {
    return sourceItems
      .map((item) => {
        if (item.type === 'board') {
          return item.id === boardId ? null : item;
        }
        const remaining = item.items.filter((b) => b.id !== boardId);
        if (remaining.length === 0) return null;
        return { ...item, items: remaining };
      })
      .filter((item): item is BoardListItem => item !== null);
  };

  const removeFolderFromItems = (folderId: string, sourceItems: BoardListItem[]): BoardListItem[] => {
    return sourceItems.filter((item) => !(item.type === 'folder' && item.id === folderId));
  };

  // ---------------------------------------------------------------------------
  // Drag and Drop Logic
  // ---------------------------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const calculateDropPosition = (
    pointerY: number,
    targetRect: { top: number; height: number },
    activeType: 'board' | 'folder',
    overType: 'board' | 'folder',
    isOverInFolder: boolean
  ): DropPosition => {
    const relativeY = pointerY - targetRect.top;
    const ratio = Math.max(0, Math.min(1, relativeY / targetRect.height));

    // Folders being dragged cannot be dropped inside other folders
    if (activeType === 'folder') {
      return ratio < 0.5 ? 'before' : 'after';
    }

    // Boards can be dropped before, after, or inside (to create folder or add to existing)
    if (overType === 'folder' || (!isOverInFolder && overType === 'board')) {
      if (ratio < 0.3) {
        return 'before';
      } else if (ratio > 0.7) {
        return 'after';
      } else {
        return 'inside';
      }
    }

    // Inside folder - only before/after
    return ratio < 0.5 ? 'before' : 'after';
  };

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const parsed = parseDragId(active.id);

    setDragState({
      activeId: active.id,
      activeType: parsed.type,
      overId: null,
      overType: null,
      dropPosition: null,
    });

    // Auto-select board when starting to drag
    if (parsed.type === 'board') {
      onSelectBoard(parsed.id);
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    const { active, over } = event;

    // Get pointer position from activator event + delta
    const activatorEvent = event.activatorEvent as PointerEvent | MouseEvent | TouchEvent;
    let initialY = 0;
    if ('clientY' in activatorEvent) {
      initialY = activatorEvent.clientY;
    } else if ('touches' in activatorEvent && activatorEvent.touches.length > 0) {
      initialY = activatorEvent.touches[0].clientY;
    }
    const pointerY = initialY + (event.delta?.y ?? 0);

    if (!over) {
      setDragState((prev) => ({
        ...prev,
        overId: null,
        overType: null,
        dropPosition: null,
      }));
      return;
    }

    // Don't show indicator on the item being dragged
    if (over.id === active.id) {
      setDragState((prev) => ({
        ...prev,
        overId: null,
        overType: null,
        dropPosition: null,
      }));
      return;
    }

    const activeParsed = parseDragId(active.id);
    const overParsed = parseDragId(over.id);
    const overData = over.data.current as { type?: string; inFolder?: boolean; parentFolderId?: string } | undefined;
    const isOverInFolder = overData?.inFolder ?? false;

    const dropPosition = calculateDropPosition(
      pointerY,
      over.rect,
      activeParsed.type,
      overParsed.type,
      isOverInFolder
    );

    setDragState((prev) => ({
      ...prev,
      overId: over.id,
      overType: overParsed.type,
      dropPosition,
    }));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    // Save current drag state before clearing
    const currentDragState = { ...dragState };
    setDragState({
      activeId: null,
      activeType: null,
      overId: null,
      overType: null,
      dropPosition: null,
    });

    if (!over || active.id === over.id) return;

    const activeParsed = parseDragId(active.id);
    const overParsed = parseDragId(over.id);
    const overData = over.data.current as { type?: string; inFolder?: boolean; parentFolderId?: string } | undefined;
    const isOverInFolder = overData?.inFolder ?? false;
    const parentFolderId = overData?.parentFolderId;

    const dropPosition = currentDragState.dropPosition ?? 'after';

    // Handle the different drag scenarios
    if (activeParsed.type === 'folder') {
      handleFolderDrop(activeParsed.id, overParsed, isOverInFolder, parentFolderId, dropPosition);
    } else {
      handleBoardDrop(activeParsed.id, overParsed, isOverInFolder, dropPosition);
    }
  };

  const handleFolderDrop = (
    folderId: string,
    over: { type: 'board' | 'folder'; id: string },
    isOverInFolder: boolean,
    parentFolderId: string | undefined,
    dropPosition: DropPosition
  ) => {
    // When over an item inside a folder, target the parent folder
    const targetId = isOverInFolder && parentFolderId ? parentFolderId : over.id;
    const targetIsFolder = isOverInFolder ? true : over.type === 'folder';

    // Cannot drop folder into itself
    if (targetIsFolder && targetId === folderId) return;

    const folder = items.find((item) => item.type === 'folder' && item.id === folderId) as BoardFolder | undefined;
    if (!folder) return;

    // Remove folder from current position
    let newItems = removeFolderFromItems(folderId, items);

    // Find target position
    let targetIndex = newItems.findIndex((item) =>
      targetIsFolder
        ? item.type === 'folder' && item.id === targetId
        : item.type === 'board' && item.id === targetId
    );

    if (targetIndex === -1) targetIndex = newItems.length;

    // Insert at new position
    const insertIndex = dropPosition === 'after' || dropPosition === 'inside' ? targetIndex + 1 : targetIndex;
    newItems = [...newItems.slice(0, insertIndex), folder, ...newItems.slice(insertIndex)];

    onUpdateItems(cleanupFolders(newItems));
  };

  const handleBoardDrop = (
    boardId: string,
    over: { type: 'board' | 'folder'; id: string },
    isOverInFolder: boolean,
    dropPosition: DropPosition
  ) => {
    const sourceBoard = getBoardById(boardId);
    if (!sourceBoard) return;

    // Case 1: Dropping board INSIDE a folder
    if (over.type === 'folder' && dropPosition === 'inside') {
      const targetFolder = getFolderById(over.id);
      if (!targetFolder) return;

      let newItems = removeBoardFromItems(boardId, items);
      newItems = newItems.map((item) => {
        if (item.type === 'folder' && item.id === over.id) {
          return { ...item, items: [...item.items, stripBoardType(sourceBoard)] };
        }
        return item;
      });

      onUpdateItems(cleanupFolders(newItems));
      return;
    }

    // Case 2: Dropping board ON another board (outside folder) to CREATE a folder
    if (over.type === 'board' && dropPosition === 'inside' && !isOverInFolder) {
      const targetBoard = getBoardById(over.id);
      if (!targetBoard || targetBoard.id === boardId) return;

      // Find target board position
      const targetIndex = items.findIndex((item) => item.type === 'board' && item.id === over.id);
      if (targetIndex === -1) return;

      // Remove both boards
      let newItems = removeBoardFromItems(boardId, items);
      newItems = removeBoardFromItems(over.id, newItems);

      // Create new folder
      const newFolder: BoardFolder = {
        type: 'folder',
        id: generateFolderId(),
        name: targetBoard.name,
        items: [stripBoardType(targetBoard), stripBoardType(sourceBoard)],
      };

      // Insert folder at target position
      const insertIndex = Math.min(targetIndex, newItems.length);
      newItems = [...newItems.slice(0, insertIndex), newFolder, ...newItems.slice(insertIndex)];

      onUpdateItems(cleanupFolders(newItems));
      return;
    }

    // Case 3: Dropping board BEFORE/AFTER a folder (at root level)
    if (over.type === 'folder' && (dropPosition === 'before' || dropPosition === 'after')) {
      let newItems = removeBoardFromItems(boardId, items);
      const targetIndex = newItems.findIndex((item) => item.type === 'folder' && item.id === over.id);
      if (targetIndex === -1) return;

      const insertIndex = dropPosition === 'after' ? targetIndex + 1 : targetIndex;
      const boardItem = { ...sourceBoard, type: 'board' as const };
      newItems = [...newItems.slice(0, insertIndex), boardItem, ...newItems.slice(insertIndex)];

      onUpdateItems(cleanupFolders(newItems));
      return;
    }

    // Case 4: Dropping board BEFORE/AFTER another board
    if (over.type === 'board') {
      let newItems = removeBoardFromItems(boardId, items);

      // Find target board in the new items
      let targetRootIndex = -1;
      let targetFolderIndex: number | undefined;

      for (let i = 0; i < newItems.length; i++) {
        const item = newItems[i];
        if (item.type === 'board' && item.id === over.id) {
          targetRootIndex = i;
          break;
        }
        if (item.type === 'folder') {
          const idx = item.items.findIndex((b) => b.id === over.id);
          if (idx !== -1) {
            targetRootIndex = i;
            targetFolderIndex = idx;
            break;
          }
        }
      }

      if (targetRootIndex === -1) return;

      if (targetFolderIndex !== undefined) {
        // Target is inside a folder
        const folder = newItems[targetRootIndex] as BoardFolder;
        const insertIdx = dropPosition === 'after' ? targetFolderIndex + 1 : targetFolderIndex;
        const newFolderItems = [
          ...folder.items.slice(0, insertIdx),
          stripBoardType(sourceBoard),
          ...folder.items.slice(insertIdx),
        ];
        newItems = newItems.map((item, idx) =>
          idx === targetRootIndex ? { ...item, items: newFolderItems } : item
        ) as BoardListItem[];
      } else {
        // Target is at root level
        const insertIdx = dropPosition === 'after' ? targetRootIndex + 1 : targetRootIndex;
        const boardItem = { ...sourceBoard, type: 'board' as const };
        newItems = [...newItems.slice(0, insertIdx), boardItem, ...newItems.slice(insertIdx)];
      }

      onUpdateItems(cleanupFolders(newItems));
    }
  };

  // ---------------------------------------------------------------------------
  // Menu Content
  // ---------------------------------------------------------------------------
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
    if (!folder) return null;
    return (
      <>
        <button onClick={() => handleStartFolderEdit(folder.id, folder.name)}>
          <FontAwesomeIcon icon={faPen} />
          Rename Folder
        </button>
      </>
    );
  })();

  // ---------------------------------------------------------------------------
  // Get active item for drag overlay
  // ---------------------------------------------------------------------------
  const activeItem = useMemo(() => {
    if (!dragState.activeId) return null;
    const parsed = parseDragId(dragState.activeId);
    if (parsed.type === 'folder') {
      return getFolderById(parsed.id);
    }
    return getBoardById(parsed.id);
  }, [dragState.activeId, items]);

  // ---------------------------------------------------------------------------
  // Render collapsed view
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Render main view
  // ---------------------------------------------------------------------------
  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis, restrictToWindowEdges]}
      measuring={{
        droppable: { strategy: MeasuringStrategy.Always },
      }}
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

        <div className="boards-scroll" ref={boardsScrollRef}>
          {items.length === 0 ? (
            <div className="no-boards">
              <p>No boards yet</p>
              <p className="hint">Create a new board to get started</p>
            </div>
          ) : (
            items.map((item) => {
              if (item.type === 'folder') {
                const folderId = makeDragId('folder', item.id);
                const isOverFolder = dragState.overId === folderId;
                const folderDropPosition = isOverFolder ? dragState.dropPosition : null;
                const isFolderDragSource = dragState.activeId === folderId;

                return (
                  <DraggableFolderItem
                    key={item.id}
                    folder={item}
                    isCollapsed={isFolderCollapsed(item.id)}
                    isEditing={editingFolderId === item.id}
                    editName={editFolderName}
                    onEditNameChange={setEditFolderName}
                    onSaveEdit={() => handleSaveFolderEdit(item.id)}
                    onCancelEdit={() => setEditingFolderId(null)}
                    onToggleCollapse={() => toggleFolderCollapsed(item.id)}
                    onOpenMenu={(e) => openMenu(e, 'folder', item.id)}
                    disabled={dragDisabled || editingFolderId === item.id}
                    dropPosition={folderDropPosition}
                    isDragSource={isFolderDragSource}
                  >
                    {item.items.map((board) => {
                      const isOverBoard = dragState.overId === board.id;
                      const boardDropPosition = isOverBoard ? dragState.dropPosition : null;
                      const isBoardDragSource = dragState.activeId === board.id;

                      return (
                        <DraggableBoardItem
                          key={board.id}
                          board={board}
                          isActive={board.id === activeBoardId}
                          isEditing={editingId === board.id}
                          editName={editName}
                          onEditNameChange={setEditName}
                          onSaveEdit={() => handleSaveEdit(board.id)}
                          onCancelEdit={() => setEditingId(null)}
                          onSelect={() => onSelectBoard(board.id)}
                          onOpenMenu={(e) => openMenu(e, 'board', board.id)}
                          formatDate={formatDate}
                          disabled={dragDisabled || editingId === board.id}
                          inFolder
                          parentFolderId={item.id}
                          dropPosition={boardDropPosition}
                          isDragSource={isBoardDragSource}
                        />
                      );
                    })}
                  </DraggableFolderItem>
                );
              }

              const isOverBoard = dragState.overId === item.id;
              const boardDropPosition = isOverBoard ? dragState.dropPosition : null;
              const isBoardDragSource = dragState.activeId === item.id;

              return (
                <DraggableBoardItem
                  key={item.id}
                  board={item}
                  isActive={item.id === activeBoardId}
                  isEditing={editingId === item.id}
                  editName={editName}
                  onEditNameChange={setEditName}
                  onSaveEdit={() => handleSaveEdit(item.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSelect={() => onSelectBoard(item.id)}
                  onOpenMenu={(e) => openMenu(e, 'board', item.id)}
                  formatDate={formatDate}
                  disabled={dragDisabled || editingId === item.id}
                  dropPosition={boardDropPosition}
                  isDragSource={isBoardDragSource}
                />
              );
            })
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

      {/* Drag Overlay - shows a preview following the cursor */}
      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
        }}
      >
        {activeItem ? (
          'items' in activeItem ? (
            <FolderOverlay folder={activeItem as BoardFolder} />
          ) : (
            <BoardOverlay board={activeItem as Board} formatDate={formatDate} />
          )
        ) : null}
      </DragOverlay>

      {/* Context menu portal */}
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
