import type { Board, BoardFolder, BoardListItem } from '../types/board';

export type DropPosition = 'before' | 'after' | 'inside';

export interface DragItemRef {
  type: 'board' | 'folder';
  id: string;
}

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

const asBoardListBoard = (board: Board): BoardListItem => ({
  ...board,
  type: 'board',
});

export const cleanupFolders = (nextItems: BoardListItem[]): BoardListItem[] => {
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
      const board = asBoardListBoard(remaining[0]);
      seen.add(board.id);
      normalized.push(board);
      continue;
    }

    remaining.forEach((board) => seen.add(board.id));
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
      if (remaining.length === 0) return null;
      return { ...item, items: remaining };
    })
    .filter((item): item is BoardListItem => item !== null);

export const removeFolderFromItems = (
  folderId: string,
  sourceItems: BoardListItem[],
): BoardListItem[] =>
  sourceItems.filter((item) => !(item.type === 'folder' && item.id === folderId));

export const findBoardById = (items: BoardListItem[], boardId: string): Board | undefined => {
  for (const item of items) {
    if (item.type === 'board' && item.id === boardId) {
      return item;
    }
    if (item.type === 'folder') {
      const board = item.items.find((entry) => entry.id === boardId);
      if (board) return board;
    }
  }
  return undefined;
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

const findBoardLocation = (
  items: BoardListItem[],
  boardId: string,
): { rootIndex: number; folderIndex?: number } | null => {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.type === 'board' && item.id === boardId) {
      return { rootIndex: i };
    }
    if (item.type === 'folder') {
      const folderIndex = item.items.findIndex((board) => board.id === boardId);
      if (folderIndex !== -1) {
        return { rootIndex: i, folderIndex };
      }
    }
  }
  return null;
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
  const targetId = isOverInFolder && parentFolderId ? parentFolderId : over.id;
  const targetIsFolder = isOverInFolder ? true : over.type === 'folder';

  if (targetIsFolder && targetId === folderId) {
    return null;
  }

  const sourceFolder = findFolderById(items, folderId);
  if (!sourceFolder) {
    return null;
  }

  const newItems = removeFolderFromItems(folderId, items);
  let targetIndex = newItems.findIndex((item) =>
    targetIsFolder
      ? item.type === 'folder' && item.id === targetId
      : item.type === 'board' && item.id === targetId,
  );

  if (targetIndex === -1) {
    targetIndex = newItems.length;
  }

  const insertIndex =
    dropPosition === 'after' || dropPosition === 'inside' ? targetIndex + 1 : targetIndex;

  return cleanupFolders([
    ...newItems.slice(0, insertIndex),
    sourceFolder,
    ...newItems.slice(insertIndex),
  ]);
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
  if (!sourceBoard) {
    return null;
  }

  if (over.type === 'folder' && dropPosition === 'inside') {
    const targetFolder = findFolderById(items, over.id);
    if (!targetFolder) return null;

    const withoutSource = removeBoardFromItems(boardId, items);
    const withInserted = withoutSource.map((item) => {
      if (item.type === 'folder' && item.id === targetFolder.id) {
        return { ...item, items: [...item.items, stripBoardType(sourceBoard)] };
      }
      return item;
    });
    return cleanupFolders(withInserted);
  }

  if (over.type === 'board' && dropPosition === 'inside' && !isOverInFolder) {
    const targetBoard = findBoardById(items, over.id);
    if (!targetBoard || targetBoard.id === boardId) {
      return null;
    }

    const targetIndex = items.findIndex((item) => item.type === 'board' && item.id === over.id);
    if (targetIndex === -1) {
      return null;
    }

    let newItems = removeBoardFromItems(boardId, items);
    newItems = removeBoardFromItems(over.id, newItems);

    const folder: BoardFolder = {
      type: 'folder',
      id: generateFolderId(),
      name: targetBoard.name,
      items: [stripBoardType(targetBoard), stripBoardType(sourceBoard)],
    };

    const insertIndex = Math.min(targetIndex, newItems.length);
    return cleanupFolders([
      ...newItems.slice(0, insertIndex),
      folder,
      ...newItems.slice(insertIndex),
    ]);
  }

  if (over.type === 'folder' && (dropPosition === 'before' || dropPosition === 'after')) {
    const newItems = removeBoardFromItems(boardId, items);
    const targetIndex = newItems.findIndex((item) => item.type === 'folder' && item.id === over.id);
    if (targetIndex === -1) {
      return null;
    }

    const insertIndex = dropPosition === 'after' ? targetIndex + 1 : targetIndex;
    return cleanupFolders([
      ...newItems.slice(0, insertIndex),
      asBoardListBoard(sourceBoard),
      ...newItems.slice(insertIndex),
    ]);
  }

  if (over.type !== 'board') {
    return null;
  }

  let newItems = removeBoardFromItems(boardId, items);
  const targetLocation = findBoardLocation(newItems, over.id);
  if (!targetLocation) {
    return null;
  }

  if (targetLocation.folderIndex !== undefined) {
    const folder = newItems[targetLocation.rootIndex] as BoardFolder;
    const insertIndex =
      dropPosition === 'after' ? targetLocation.folderIndex + 1 : targetLocation.folderIndex;
    const nextFolderItems = [
      ...folder.items.slice(0, insertIndex),
      stripBoardType(sourceBoard),
      ...folder.items.slice(insertIndex),
    ];
    newItems = newItems.map((item, index) =>
      index === targetLocation.rootIndex ? { ...item, items: nextFolderItems } : item,
    );
    return cleanupFolders(newItems);
  }

  const insertIndex =
    dropPosition === 'after' ? targetLocation.rootIndex + 1 : targetLocation.rootIndex;
  return cleanupFolders([
    ...newItems.slice(0, insertIndex),
    asBoardListBoard(sourceBoard),
    ...newItems.slice(insertIndex),
  ]);
};
