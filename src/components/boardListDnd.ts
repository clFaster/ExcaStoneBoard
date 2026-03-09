import type { Board, BoardFolder, BoardListBoard, BoardListItem } from '../types/board';

export type DropPosition = 'before' | 'after' | 'inside';

export interface DragItemRef {
  type: 'board' | 'folder';
  id: string;
}

interface BoardLocation {
  rootIndex: number;
  folderIndex?: number;
}

interface BoardDropContext {
  sourceBoard: Board;
  sourceBoardId: string;
  items: BoardListItem[];
}

interface FolderTargetDropInput {
  context: BoardDropContext;
  targetFolderId: string;
  dropPosition: DropPosition;
}

interface BoardTargetDropInput {
  context: BoardDropContext;
  targetBoardId: string;
  dropPosition: DropPosition;
}

interface FolderInsideDropInput {
  context: BoardDropContext;
  targetFolderId: string;
}

interface CreateFolderDropInput {
  context: BoardDropContext;
  targetBoardId: string;
}

const asBoardListBoard = (board: Board): BoardListBoard => ({
  ...board,
  type: 'board',
});

const insertAt = <T>(items: T[], index: number, value: T): T[] => [
  ...items.slice(0, index),
  value,
  ...items.slice(index),
];

const isFolder = (item: BoardListItem): item is BoardFolder => item.type === 'folder';

const findRootBoardIndex = (items: BoardListItem[], boardId: string): number =>
  items.findIndex((item) => item.type === 'board' && item.id === boardId);

const findFolderContainingBoard = (
  items: BoardListItem[],
  boardId: string,
): { rootIndex: number; folder: BoardFolder; folderIndex: number } | null => {
  const rootIndex = items.findIndex(
    (item) => isFolder(item) && item.items.some((board) => board.id === boardId),
  );
  if (rootIndex === -1) return null;

  const folder = items[rootIndex] as BoardFolder;
  const folderIndex = folder.items.findIndex((board) => board.id === boardId);
  if (folderIndex === -1) return null;

  return { rootIndex, folder, folderIndex };
};

const canCreateFolderFromBoards = (
  over: DragItemRef,
  dropPosition: DropPosition,
  isOverInFolder: boolean,
): boolean => over.type === 'board' && dropPosition === 'inside' && !isOverInFolder;

const isFolderEdgeDrop = (over: DragItemRef, dropPosition: DropPosition): boolean =>
  over.type === 'folder' && (dropPosition === 'before' || dropPosition === 'after');

const ensureDropIndex = (targetIndex: number, dropPosition: DropPosition): number =>
  dropPosition === 'after' || dropPosition === 'inside' ? targetIndex + 1 : targetIndex;

const resolveFolderDropTarget = (
  over: DragItemRef,
  isOverInFolder: boolean,
  parentFolderId?: string,
): DragItemRef => {
  if (isOverInFolder && parentFolderId) {
    return { type: 'folder', id: parentFolderId };
  }
  return { type: isOverInFolder ? 'folder' : over.type, id: over.id };
};

const findTargetIndex = (items: BoardListItem[], target: DragItemRef): number => {
  if (target.type === 'folder') {
    return items.findIndex((item) => item.type === 'folder' && item.id === target.id);
  }
  return items.findIndex((item) => item.type === 'board' && item.id === target.id);
};

export const parseDragId = (id: string): DragItemRef => {
  if (id.startsWith('folder:')) {
    return { type: 'folder', id: id.slice('folder:'.length) };
  }
  return { type: 'board', id };
};

export const makeDragId = (type: 'board' | 'folder', id: string): string =>
  type === 'folder' ? `folder:${id}` : id;

export const stripBoardType = (board: Board): Board => {
  const maybeTyped = board as Board & { type?: string };
  if (maybeTyped.type) {
    const { type: _type, ...rest } = maybeTyped;
    return rest;
  }
  return board;
};

export const generateFolderId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `folder-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const cleanupFolders = (nextItems: BoardListItem[]): BoardListItem[] => {
  const seen = new Set<string>();
  const normalized: BoardListItem[] = [];

  for (const item of nextItems) {
    if (item.type === 'board') {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        normalized.push(item);
      }
      continue;
    }

    const remaining = item.items.filter((board) => !seen.has(board.id));
    if (remaining.length === 0) continue;

    remaining.forEach((board) => seen.add(board.id));
    if (remaining.length === 1) {
      normalized.push(asBoardListBoard(remaining[0]));
      continue;
    }

    normalized.push({ ...item, items: remaining });
  }

  return normalized;
};

export const removeBoardFromItems = (
  boardId: string,
  sourceItems: BoardListItem[],
): BoardListItem[] =>
  sourceItems
    .map((item) => {
      if (item.type === 'board') {
        return item.id === boardId ? null : item;
      }
      const remaining = item.items.filter((board) => board.id !== boardId);
      return remaining.length === 0 ? null : { ...item, items: remaining };
    })
    .filter((item): item is BoardListItem => item !== null);

export const removeFolderFromItems = (
  folderId: string,
  sourceItems: BoardListItem[],
): BoardListItem[] =>
  sourceItems.filter((item) => !(item.type === 'folder' && item.id === folderId));

export const findBoardById = (items: BoardListItem[], boardId: string): Board | undefined => {
  const rootIndex = findRootBoardIndex(items, boardId);
  if (rootIndex !== -1) {
    return items[rootIndex] as BoardListBoard;
  }
  return findFolderContainingBoard(items, boardId)?.folder.items.find(
    (board) => board.id === boardId,
  );
};

export const findFolderById = (
  items: BoardListItem[],
  folderId: string,
): BoardFolder | undefined => {
  const folder = items.find((item) => item.type === 'folder' && item.id === folderId);
  return folder && folder.type === 'folder' ? folder : undefined;
};

export const calculateDropPosition = (
  pointerY: number,
  targetRect: { top: number; height: number },
  activeType: 'board' | 'folder',
  overType: 'board' | 'folder',
  isOverInFolder: boolean,
): DropPosition => {
  const relativeY = pointerY - targetRect.top;
  const ratio = Math.max(0, Math.min(1, relativeY / targetRect.height));

  if (activeType === 'folder') {
    return ratio < 0.5 ? 'before' : 'after';
  }

  if (overType === 'folder' || (!isOverInFolder && overType === 'board')) {
    if (ratio < 0.3) return 'before';
    if (ratio > 0.7) return 'after';
    return 'inside';
  }

  return ratio < 0.5 ? 'before' : 'after';
};

const findBoardLocation = (items: BoardListItem[], boardId: string): BoardLocation | null => {
  const rootIndex = findRootBoardIndex(items, boardId);
  if (rootIndex !== -1) {
    return { rootIndex };
  }

  const folderMatch = findFolderContainingBoard(items, boardId);
  if (!folderMatch) return null;

  return { rootIndex: folderMatch.rootIndex, folderIndex: folderMatch.folderIndex };
};

const dropBoardInsideFolder = (input: FolderInsideDropInput): BoardListItem[] | null => {
  const { context, targetFolderId } = input;
  const targetFolder = findFolderById(context.items, targetFolderId);
  if (!targetFolder) return null;

  const withoutSource = removeBoardFromItems(context.sourceBoardId, context.items);
  const withInserted = withoutSource.map((item) =>
    item.type === 'folder' && item.id === targetFolder.id
      ? { ...item, items: [...item.items, stripBoardType(context.sourceBoard)] }
      : item,
  );
  return cleanupFolders(withInserted);
};

const createFolderFromBoards = (input: CreateFolderDropInput): BoardListItem[] | null => {
  const { context, targetBoardId } = input;
  const targetBoard = findBoardById(context.items, targetBoardId);
  if (!targetBoard || targetBoard.id === context.sourceBoardId) return null;

  const targetRootIndex = findRootBoardIndex(context.items, targetBoardId);
  if (targetRootIndex === -1) return null;

  let nextItems = removeBoardFromItems(context.sourceBoardId, context.items);
  nextItems = removeBoardFromItems(targetBoardId, nextItems);

  const newFolder: BoardFolder = {
    type: 'folder',
    id: generateFolderId(),
    name: targetBoard.name,
    items: [stripBoardType(targetBoard), stripBoardType(context.sourceBoard)],
  };

  const insertIndex = Math.min(targetRootIndex, nextItems.length);
  return cleanupFolders(insertAt(nextItems, insertIndex, newFolder));
};

const dropBoardAroundFolder = (input: FolderTargetDropInput): BoardListItem[] | null => {
  const { context, targetFolderId, dropPosition } = input;
  const nextItems = removeBoardFromItems(context.sourceBoardId, context.items);
  const targetIndex = nextItems.findIndex(
    (item) => item.type === 'folder' && item.id === targetFolderId,
  );
  if (targetIndex === -1) return null;

  const insertIndex = dropPosition === 'after' ? targetIndex + 1 : targetIndex;
  return cleanupFolders(insertAt(nextItems, insertIndex, asBoardListBoard(context.sourceBoard)));
};

const dropBoardAroundBoard = (input: BoardTargetDropInput): BoardListItem[] | null => {
  const { context, targetBoardId, dropPosition } = input;
  const nextItems = removeBoardFromItems(context.sourceBoardId, context.items);
  const location = findBoardLocation(nextItems, targetBoardId);
  if (!location) return null;

  if (location.folderIndex !== undefined) {
    const folder = nextItems[location.rootIndex] as BoardFolder;
    const insertIndex = dropPosition === 'after' ? location.folderIndex + 1 : location.folderIndex;
    const nextFolderItems = insertAt(
      folder.items,
      insertIndex,
      stripBoardType(context.sourceBoard),
    );
    const withFolderUpdate = nextItems.map((item, index) =>
      index === location.rootIndex ? { ...item, items: nextFolderItems } : item,
    );
    return cleanupFolders(withFolderUpdate);
  }

  const rootInsertIndex = dropPosition === 'after' ? location.rootIndex + 1 : location.rootIndex;
  return cleanupFolders(
    insertAt(nextItems, rootInsertIndex, asBoardListBoard(context.sourceBoard)),
  );
};

interface ApplyFolderDropInput {
  folderId: string;
  over: DragItemRef;
  isOverInFolder: boolean;
  parentFolderId?: string;
  dropPosition: DropPosition;
  items: BoardListItem[];
}

export const applyFolderDrop = ({
  folderId,
  over,
  isOverInFolder,
  parentFolderId,
  dropPosition,
  items,
}: ApplyFolderDropInput): BoardListItem[] | null => {
  const target = resolveFolderDropTarget(over, isOverInFolder, parentFolderId);
  if (target.type === 'folder' && target.id === folderId) return null;

  const sourceFolder = findFolderById(items, folderId);
  if (!sourceFolder) return null;

  const nextItems = removeFolderFromItems(folderId, items);
  const targetIndex = findTargetIndex(nextItems, target);
  const resolvedTargetIndex = targetIndex === -1 ? nextItems.length : targetIndex;
  const insertIndex = ensureDropIndex(resolvedTargetIndex, dropPosition);

  return cleanupFolders(insertAt(nextItems, insertIndex, sourceFolder));
};

interface ApplyBoardDropInput {
  boardId: string;
  over: DragItemRef;
  isOverInFolder: boolean;
  dropPosition: DropPosition;
  items: BoardListItem[];
}

export const applyBoardDrop = ({
  boardId,
  over,
  isOverInFolder,
  dropPosition,
  items,
}: ApplyBoardDropInput): BoardListItem[] | null => {
  const sourceBoard = findBoardById(items, boardId);
  if (!sourceBoard) return null;

  const context: BoardDropContext = { sourceBoard, sourceBoardId: boardId, items };

  if (over.type === 'folder' && dropPosition === 'inside') {
    return dropBoardInsideFolder({ context, targetFolderId: over.id });
  }

  if (canCreateFolderFromBoards(over, dropPosition, isOverInFolder)) {
    return createFolderFromBoards({ context, targetBoardId: over.id });
  }

  if (isFolderEdgeDrop(over, dropPosition)) {
    return dropBoardAroundFolder({ context, targetFolderId: over.id, dropPosition });
  }

  if (over.type === 'board') {
    return dropBoardAroundBoard({ context, targetBoardId: over.id, dropPosition });
  }

  return null;
};
