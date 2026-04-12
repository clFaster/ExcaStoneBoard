import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { confirm, open as openDialog } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowUpRightFromSquare,
  faCheck,
  faChevronDown,
  faChevronLeft,
  faChevronRight,
  faClone,
  faCopy,
  faDownload,
  faEllipsisVertical,
  faFileCode,
  faFileImage,
  faGear,
  faGripVertical,
  faPen,
  faPlus,
  faStar,
  faTrash,
  faUpload,
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
import type {
  Board,
  BoardFolder,
  BoardListItem,
  BoardsExportEntry,
  BoardsExportFile,
  BoardsImportResult,
} from '../types/board';
import {
  applyBoardDrop,
  applyFolderDrop,
  calculateDropPosition,
  cleanupFolders,
  findBoardById,
  findFolderById,
  makeDragId,
  parseDragId,
  type DropPosition,
} from './boardListDnd';
import './BoardList.css';

// =============================================================================
// Types
// =============================================================================

interface BoardListProps {
  items: BoardListItem[];
  activeBoardId: string | null;
  thumbnails: Record<string, string>;
  onSelectBoard: (boardId: string) => void;
  onCreateBoard: (name: string) => void;
  onRenameBoard: (boardId: string, newName: string) => void;
  onDeleteBoard: (boardId: string) => void;
  onDuplicateBoard: (boardId: string, newName: string) => void;
  onUpdateItems: (items: BoardListItem[]) => void;
  onExportPng: () => void;
  onCopyPng: () => void;
  onExportSvg: () => void;
  onExportBoards: () => Promise<void>;
  onImportBoards: (filePath: string, selectedIndices: number[]) => Promise<BoardsImportResult>;
  exportDisabled: boolean;
  boardsExporting: boolean;
  boardsImporting: boolean;
  hideExportRow: boolean;
  onHideExportRowChange: (value: boolean) => void;
  showTimestamps: boolean;
  onShowTimestampsChange: (value: boolean) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

interface DragState {
  activeId: UniqueIdentifier | null;
  activeType: 'board' | 'folder' | null;
  overId: UniqueIdentifier | null;
  overType: 'board' | 'folder' | null;
  dropPosition: DropPosition | null;
}

interface ImportBoardEntry extends BoardsExportEntry {
  key: string;
  index: number;
}

// =============================================================================
// Utility Functions
// =============================================================================

const pruneCollapsedFolderState = (
  collapsed: Record<string, boolean>,
  items: BoardListItem[],
): Record<string, boolean> => {
  const folderIds = new Set(items.filter((item) => item.type === 'folder').map((item) => item.id));
  const next: Record<string, boolean> = {};
  for (const [id, value] of Object.entries(collapsed)) {
    if (folderIds.has(id)) {
      next[id] = value;
    }
  }
  return next;
};

const handleInlineEditorKeyDown = (
  event: React.KeyboardEvent<HTMLInputElement>,
  onSave: () => void,
  onCancel: () => void,
) => {
  if (event.key === 'Enter') {
    onSave();
    return;
  }

  if (event.key === 'Escape') {
    onCancel();
  }
};

const resolveDialogFilePath = (result: string | string[] | null) => {
  if (!result) {
    return null;
  }

  return Array.isArray(result) ? result[0] || null : result;
};

const buildImportSelectionMap = (entries: ImportBoardEntry[], existingBoardIds: Set<string>) => {
  const seenImportIds = new Set<string>();
  return Object.fromEntries(
    entries.map((entry) => {
      const hasId = Boolean(entry.id);
      const isDuplicate = hasId && (existingBoardIds.has(entry.id) || seenImportIds.has(entry.id));

      if (hasId) {
        seenImportIds.add(entry.id);
      }

      return [entry.key, !isDuplicate];
    }),
  );
};

const buildImportBoards = (payload: Partial<BoardsExportFile>): ImportBoardEntry[] => {
  if (!Array.isArray(payload.boards)) return [];
  const seen = new Set<string>();
  return payload.boards.reduce<ImportBoardEntry[]>((acc, entry, index) => {
    if (!entry || typeof entry.name !== 'string') return acc;
    const name = entry.name.trim() || 'Untitled board';
    const baseKey = String(entry.id || `import-${index + 1}`);
    let key = baseKey;
    let suffix = 1;
    while (seen.has(key)) {
      key = `${baseKey}-${suffix}`;
      suffix += 1;
    }
    seen.add(key);
    acc.push({
      ...entry,
      name,
      data: entry.data ?? null,
      key,
      index,
    });
    return acc;
  }, []);
};

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
  showTimestamps: boolean;
  disabled?: boolean;
  inFolder?: boolean;
  parentFolderId?: string;
  dropPosition?: DropPosition | null;
  isDragSource?: boolean;
  onMouseEnter?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<HTMLDivElement>) => void;
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
  showTimestamps,
  disabled,
  inFolder,
  parentFolderId,
  dropPosition,
  isDragSource,
  onMouseEnter,
  onMouseLeave,
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
      data-testid={`board-item-${board.id}`}
      onClick={() => !isEditing && onSelect()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
              {showTimestamps && <span className="board-date">{formatDate(board.updated_at)}</span>}
            </div>
          </div>
          <div className="board-actions">
            <button
              className="menu-btn"
              data-testid={`board-menu-btn-${board.id}`}
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

  const handleToggleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onToggleCollapse();
    },
    [onToggleCollapse],
  );

  return (
    <div ref={setNodeRef} className={`board-folder ${dragClass} ${dropClass}`}>
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
              onKeyDown={(e) => handleInlineEditorKeyDown(e, onSaveEdit, onCancelEdit)}
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
            onClick={handleToggleClick}
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
  showTimestamps: boolean;
}

function BoardOverlay({ board, formatDate, showTimestamps }: BoardOverlayProps) {
  return (
    <div className="board-item drag-overlay">
      <div className="board-info">
        <span className="drag-handle visible" aria-hidden="true">
          <FontAwesomeIcon icon={faGripVertical} />
        </span>
        <div className="board-text">
          <span className="board-name">{board.name}</span>
          {showTimestamps && <span className="board-date">{formatDate(board.updated_at)}</span>}
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
  thumbnails,
  onSelectBoard,
  onCreateBoard,
  onRenameBoard,
  onDeleteBoard,
  onDuplicateBoard,
  onUpdateItems,
  onExportPng,
  onCopyPng,
  onExportSvg,
  onExportBoards,
  onImportBoards,
  exportDisabled,
  boardsExporting,
  boardsImporting,
  hideExportRow,
  onHideExportRowChange,
  showTimestamps,
  onShowTimestampsChange,
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
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importBoards, setImportBoards] = useState<ImportBoardEntry[]>([]);
  const [importSelection, setImportSelection] = useState<Record<string, boolean>>({});
  const [importError, setImportError] = useState<string | null>(null);
  const [importSourceName, setImportSourceName] = useState<string | null>(null);
  const [importFilePath, setImportFilePath] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const releasesUrl = 'https://github.com/clFaster/ExcaStoneBoard/releases';

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
          : [{ board: item }],
      ),
    [items],
  );

  const existingBoardIds = useMemo(
    () => new Set(flattenedBoards.map((entry) => entry.board.id)),
    [flattenedBoards],
  );

  const duplicateImportIds = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const entry of importBoards) {
      if (!entry.id) continue;
      if (seen.has(entry.id)) duplicates.add(entry.id);
      seen.add(entry.id);
    }
    return duplicates;
  }, [importBoards]);

  const selectedImportBoards = useMemo(
    () => importBoards.filter((board) => Boolean(importSelection[board.key])),
    [importBoards, importSelection],
  );

  const getBoardById = useCallback((boardId: string) => findBoardById(items, boardId), [items]);

  const getFolderById = useCallback((folderId: string) => findFolderById(items, folderId), [items]);

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
    const frameId = window.requestAnimationFrame(() => {
      setMenuStyle({ top, left });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [activeMenu]);

  useEffect(() => {
    try {
      localStorage.setItem('boards.collapsedFolders', JSON.stringify(collapsedFolders));
    } catch {
      // ignore storage errors
    }
  }, [collapsedFolders]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setCollapsedFolders((prev) => {
        const next = pruneCollapsedFolderState(prev, items);
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [items]);

  useEffect(() => {
    let mounted = true;

    void getVersion()
      .then((version) => {
        if (!mounted) return;
        setAppVersion(version);
      })
      .catch((error) => {
        console.warn('Failed to read app version:', error);
        if (!mounted) return;
        setAppVersion('Unknown');
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const handleOpenSettings = () => {
      setSettingsOpen(true);
    };

    window.addEventListener('boardlist:open-settings', handleOpenSettings);
    return () => {
      window.removeEventListener('boardlist:open-settings', handleOpenSettings);
    };
  }, []);

  useEffect(() => {
    if (!settingsOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      if (boardsExporting || boardsImporting) {
        return;
      }

      setSettingsOpen(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [boardsExporting, boardsImporting, settingsOpen]);

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
          : item,
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
    const shouldDelete = await (async () => {
      try {
        return await confirm(message, { title: 'Delete board', kind: 'warning' });
      } catch {
        return window.confirm(message);
      }
    })();

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

  const closeImportDialog = () => {
    if (boardsImporting) return;
    setImportDialogOpen(false);
    setImportBoards([]);
    setImportSelection({});
    setImportError(null);
    setImportSourceName(null);
    setImportFilePath(null);
  };

  const openSettings = () => setSettingsOpen(true);
  const closeSettings = () => {
    if (boardsExporting || boardsImporting) return;
    setSettingsOpen(false);
  };

  const handleOpenReleases = async () => {
    try {
      await openUrl(releasesUrl);
    } catch (error) {
      console.warn('Failed to open releases page with opener plugin:', error);
      window.open(releasesUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const handleOpenImport = useCallback(async () => {
    setImportError(null);

    try {
      const testImportPath = await invoke<string | null>('get_system_test_import_path');
      const filePath = testImportPath
        ? testImportPath
        : resolveDialogFilePath(
            await openDialog({
              title: 'Import boards',
              multiple: false,
              directory: false,
              filters: [{ name: 'Boards export', extensions: ['json'] }],
            }),
          );

      if (!filePath) {
        return;
      }

      const content = await readTextFile(filePath);
      const parsed = JSON.parse(content) as Partial<BoardsExportFile>;
      const entries = buildImportBoards(parsed);

      if (entries.length === 0) {
        setImportError('No boards found in the selected file.');
        return;
      }

      const selection = buildImportSelectionMap(entries, existingBoardIds);
      const sourceName = filePath.split(/[\\/]/).pop() || 'Import file';

      setImportBoards(entries);
      setImportSelection(selection);
      setImportSourceName(sourceName);
      setImportFilePath(filePath);
      setSettingsOpen(false);
      setImportDialogOpen(true);
    } catch (e) {
      console.error('Failed to import boards:', e);
      setImportError('Import failed. Please check the file and try again.');
    }
  }, [existingBoardIds]);

  useEffect(() => {
    const handleImportBoards = () => {
      void handleOpenImport();
    };

    window.addEventListener('boardlist:import-boards', handleImportBoards);
    return () => {
      window.removeEventListener('boardlist:import-boards', handleImportBoards);
    };
  }, [handleOpenImport]);

  const handleToggleImportSelection = (key: string) => {
    setImportSelection((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSelectAllImports = () => {
    setImportSelection(Object.fromEntries(importBoards.map((entry) => [entry.key, true])));
  };

  const handleClearAllImports = () => {
    setImportSelection(Object.fromEntries(importBoards.map((entry) => [entry.key, false])));
  };

  const handleConfirmImport = async () => {
    if (boardsImporting || selectedImportBoards.length === 0) return;
    setImportError(null);

    try {
      if (!importFilePath) {
        setImportError('Import file not available. Please select a file again.');
        return;
      }
      const selectedIndices = selectedImportBoards.map((entry) => entry.index);
      await onImportBoards(importFilePath, selectedIndices);
      closeImportDialog();
    } catch (e) {
      console.error('Import failed:', e);
      setImportError('Import failed. Please try again.');
    }
  };

  const openMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    type: 'board' | 'folder',
    id: string,
  ) => {
    event.stopPropagation();
    const anchorRect = event.currentTarget.getBoundingClientRect();
    setActiveMenu((prev) => {
      if (prev && prev.type === type && prev.id === id) return null;
      return { type, id, anchorRect };
    });
  };

  const dragDisabled = Boolean(activeMenu || editingId || editingFolderId);

  // ---------------------------------------------------------------------------
  // Thumbnail Hover Handlers
  // ---------------------------------------------------------------------------
  const hoverTimerRef = useRef<number | null>(null);
  const [thumbnailPreview, setThumbnailPreview] = useState<{
    boardId: string;
    anchorRect: DOMRect;
  } | null>(null);

  const handleBoardMouseEnter = useCallback(
    (boardId: string, event: React.MouseEvent<HTMLDivElement>) => {
      // Don't show preview if dragging/editing
      if (dragDisabled) return;
      if (!thumbnails[boardId]) return;

      const rect = event.currentTarget.getBoundingClientRect();
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);

      hoverTimerRef.current = window.setTimeout(() => {
        setThumbnailPreview({ boardId, anchorRect: rect });
      }, 400);
    },
    [dragDisabled, thumbnails],
  );

  const handleBoardMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setThumbnailPreview(null);
  }, []);

  // Hide thumbnail preview when scrolling, dragging, or opening menus
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setThumbnailPreview(null);
    }, 0);
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    return () => window.clearTimeout(timeoutId);
  }, [activeMenu, dragState.activeId]);

  useEffect(() => {
    const scrollNode = boardsScrollRef.current;
    if (!scrollNode) return;
    const hide = () => {
      setThumbnailPreview(null);
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    };
    scrollNode.addEventListener('scroll', hide, { passive: true });
    return () => scrollNode.removeEventListener('scroll', hide);
  }, []);

  // ---------------------------------------------------------------------------
  // Drag and Drop Logic
  // ---------------------------------------------------------------------------
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const parsed = parseDragId(String(active.id));

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

    const activeParsed = parseDragId(String(active.id));
    const overParsed = parseDragId(String(over.id));
    const overData = over.data.current as
      | { type?: string; inFolder?: boolean; parentFolderId?: string }
      | undefined;
    const isOverInFolder = overData?.inFolder ?? false;

    const dropPosition = calculateDropPosition(
      pointerY,
      over.rect,
      activeParsed.type,
      overParsed.type,
      isOverInFolder,
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

    const activeParsed = parseDragId(String(active.id));
    const overParsed = parseDragId(String(over.id));
    const overData = over.data.current as
      | { type?: string; inFolder?: boolean; parentFolderId?: string }
      | undefined;
    const isOverInFolder = overData?.inFolder ?? false;
    const parentFolderId = overData?.parentFolderId;

    const dropPosition = currentDragState.dropPosition ?? 'after';

    const nextItems =
      activeParsed.type === 'folder'
        ? applyFolderDrop({
            folderId: activeParsed.id,
            over: overParsed,
            isOverInFolder,
            parentFolderId,
            dropPosition,
            items,
          })
        : applyBoardDrop({
            boardId: activeParsed.id,
            over: overParsed,
            isOverInFolder,
            dropPosition,
            items,
          });

    if (nextItems) {
      onUpdateItems(nextItems);
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
          <button data-testid="board-action-rename" onClick={() => handleStartEdit(board)}>
            <FontAwesomeIcon icon={faPen} />
            Rename
          </button>
          <button data-testid="board-action-duplicate" onClick={() => handleDuplicate(board)}>
            <FontAwesomeIcon icon={faClone} />
            Duplicate
          </button>
          <button
            className="danger"
            data-testid="board-action-delete"
            onClick={() => handleDelete(board)}
          >
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
    const parsed = parseDragId(String(dragState.activeId));
    if (parsed.type === 'folder') {
      return getFolderById(parsed.id);
    }
    return getBoardById(parsed.id);
  }, [dragState.activeId, getBoardById, getFolderById]);

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
          <div className="board-header-actions">
            <button
              className="icon-btn"
              data-testid="open-settings-btn"
              onClick={openSettings}
              title="Settings"
            >
              <FontAwesomeIcon icon={faGear} />
            </button>
            <button className="toggle-btn" onClick={onToggleCollapse} title="Collapse sidebar">
              <FontAwesomeIcon icon={faChevronLeft} />
            </button>
          </div>
        </div>

        {!hideExportRow && (
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
        )}

        <form className="new-board-form" onSubmit={handleCreateBoard}>
          <input
            type="text"
            data-testid="create-board-input"
            value={newBoardName}
            onChange={(e) => setNewBoardName(e.target.value)}
            placeholder="New board name..."
            className="new-board-input"
          />
          <button
            type="submit"
            className="new-board-btn"
            data-testid="create-board-submit"
            disabled={!newBoardName.trim()}
          >
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
                          showTimestamps={showTimestamps}
                          disabled={dragDisabled || editingId === board.id}
                          inFolder
                          parentFolderId={item.id}
                          dropPosition={boardDropPosition}
                          isDragSource={isBoardDragSource}
                          onMouseEnter={(e) => handleBoardMouseEnter(board.id, e)}
                          onMouseLeave={handleBoardMouseLeave}
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
                  showTimestamps={showTimestamps}
                  disabled={dragDisabled || editingId === item.id}
                  dropPosition={boardDropPosition}
                  isDragSource={isBoardDragSource}
                  onMouseEnter={(e) => handleBoardMouseEnter(item.id, e)}
                  onMouseLeave={handleBoardMouseLeave}
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

      {settingsOpen
        ? createPortal(
            <div className="modal-overlay" onClick={closeSettings}>
              <div
                className="modal settings-modal"
                data-testid="settings-modal"
                onClick={(event) => event.stopPropagation()}
              >
                <h3>Settings</h3>
                <div className="settings-section">
                  <div className="settings-section-title">Boards</div>
                  <div className="settings-actions">
                    <button
                      type="button"
                      className="settings-action-btn"
                      onClick={onExportBoards}
                      disabled={boardsExporting}
                    >
                      <FontAwesomeIcon icon={faDownload} />
                      {boardsExporting ? 'Exporting...' : 'Export boards'}
                    </button>
                    <button
                      type="button"
                      className="settings-action-btn"
                      onClick={handleOpenImport}
                      disabled={boardsImporting}
                    >
                      <FontAwesomeIcon icon={faUpload} />
                      {boardsImporting ? 'Importing...' : 'Import boards'}
                    </button>
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-title">Display</div>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      data-testid="toggle-hide-export-row"
                      checked={hideExportRow}
                      onChange={(e) => onHideExportRowChange(e.target.checked)}
                    />
                    <span className="toggle-track" aria-hidden="true"></span>
                    <span className="toggle-text">Hide export/copy buttons</span>
                  </label>
                </div>
                {!importDialogOpen && importError && (
                  <div className="settings-error">{importError}</div>
                )}
                <div className="settings-section">
                  <div className="settings-section-title">Sidebar</div>
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      data-testid="toggle-show-timestamps"
                      checked={showTimestamps}
                      onChange={(e) => onShowTimestampsChange(e.target.checked)}
                    />
                    <span className="toggle-track" aria-hidden="true"></span>
                    <span className="toggle-text">Show timestamps in sidebar</span>
                  </label>
                </div>
                <div className="settings-version-row">
                  <span className="settings-version-label">Version</span>
                  <button
                    type="button"
                    className="settings-version-link"
                    onClick={handleOpenReleases}
                  >
                    {appVersion
                      ? appVersion === 'Unknown'
                        ? 'Unknown'
                        : `v${appVersion}`
                      : 'Loading...'}
                    <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                  </button>
                </div>
                <div className="modal-actions">
                  <button
                    className="cancel-btn"
                    data-testid="close-settings-btn"
                    onClick={closeSettings}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {importDialogOpen
        ? createPortal(
            <div
              className="modal-overlay"
              onClick={() => {
                if (!boardsImporting) closeImportDialog();
              }}
            >
              <div className="modal import-modal" onClick={(event) => event.stopPropagation()}>
                <h3>Import boards</h3>
                {importSourceName && <p className="modal-hint">Source: {importSourceName}</p>}
                <div className="import-controls">
                  <button
                    type="button"
                    className="import-control-btn"
                    onClick={handleSelectAllImports}
                    disabled={boardsImporting}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="import-control-btn"
                    onClick={handleClearAllImports}
                    disabled={boardsImporting}
                  >
                    Clear
                  </button>
                </div>
                <div className="import-list">
                  {importBoards.map((entry) => {
                    const isSelected = Boolean(importSelection[entry.key]);
                    const hasId = Boolean(entry.id);
                    const isDuplicate =
                      hasId && (existingBoardIds.has(entry.id) || duplicateImportIds.has(entry.id));
                    return (
                      <label
                        key={entry.key}
                        className={`import-item ${isSelected ? 'selected' : ''} ${isDuplicate ? 'duplicate' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleImportSelection(entry.key)}
                          disabled={boardsImporting}
                        />
                        <span className="import-checkmark" aria-hidden="true"></span>
                        <span className="import-item-name">{entry.name}</span>
                        {isDuplicate && <span className="import-item-duplicate">Duplicate</span>}
                      </label>
                    );
                  })}
                </div>
                <div className="import-summary">{selectedImportBoards.length} selected</div>
                {importError && <div className="import-error">{importError}</div>}
                <div className="modal-actions">
                  <button
                    className="cancel-btn"
                    onClick={closeImportDialog}
                    disabled={boardsImporting}
                  >
                    Cancel
                  </button>
                  <button
                    className="save-btn"
                    onClick={handleConfirmImport}
                    disabled={boardsImporting || selectedImportBoards.length === 0}
                  >
                    Import
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

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
            <BoardOverlay
              board={activeItem as Board}
              formatDate={formatDate}
              showTimestamps={showTimestamps}
            />
          )
        ) : null}
      </DragOverlay>

      {/* Thumbnail hover preview portal */}
      {thumbnailPreview && thumbnails[thumbnailPreview.boardId]
        ? createPortal(
            <div
              className="thumbnail-preview"
              style={{
                position: 'fixed',
                top: thumbnailPreview.anchorRect.top + thumbnailPreview.anchorRect.height / 2,
                left: thumbnailPreview.anchorRect.right + 12,
                transform: 'translateY(-50%)',
              }}
            >
              <img
                src={thumbnails[thumbnailPreview.boardId]}
                alt="Board preview"
                className="thumbnail-preview-img"
              />
            </div>,
            document.body,
          )
        : null}

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
            document.body,
          )
        : null}
    </DndContext>
  );
}
