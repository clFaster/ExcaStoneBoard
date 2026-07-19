import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Board,
  BoardMutationResult,
  BoardsIndex,
  BoardListItem,
  ExcalidrawData,
} from '../types/board';

export function useBoards() {
  const [items, setItems] = useState<BoardListItem[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBoards = useCallback(async () => {
    try {
      setLoading(true);
      const index = await invoke<BoardsIndex>('get_boards');
      setItems(index.items);
      setActiveBoardId(index.active_board_id);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Intentional fetch-on-mount/dependency-change; loadBoards sets loading state
    // synchronously before its first await, which is expected here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadBoards();
  }, [loadBoards]);

  const applyIndex = useCallback((index: BoardsIndex) => {
    setItems(index.items);
    setActiveBoardId(index.active_board_id);
  }, []);

  const runMutation = useCallback(async <T>(action: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      const result = await action();
      setError(null);
      return result;
    } catch (e) {
      setError(String(e));
      return fallback;
    }
  }, []);

  const createBoard = (name: string): Promise<Board | null> => {
    return runMutation(async () => {
      const result = await invoke<BoardMutationResult>('create_board', { name });
      applyIndex(result.index);
      return result.board;
    }, null);
  };

  const renameBoard = (boardId: string, newName: string): Promise<boolean> => {
    return runMutation(async () => {
      const renamedBoard = await invoke<Board>('rename_board', { boardId, newName });
      setItems((currentItems) =>
        currentItems.map((item) => {
          if (item.type === 'board') {
            return item.id === boardId ? { ...renamedBoard, type: 'board' } : item;
          }

          if (!item.items.some((board) => board.id === boardId)) {
            return item;
          }

          return {
            ...item,
            items: item.items.map((board) => (board.id === boardId ? renamedBoard : board)),
          };
        }),
      );
      return true;
    }, false);
  };

  const deleteBoard = (boardId: string): Promise<boolean> => {
    return runMutation(async () => {
      const index = await invoke<BoardsIndex>('delete_board', { boardId });
      applyIndex(index);
      return true;
    }, false);
  };

  const setActiveBoard = (boardId: string): Promise<boolean> => {
    return runMutation(async () => {
      await invoke('set_active_board', { boardId });
      setActiveBoardId(boardId);
      return true;
    }, false);
  };

  const duplicateBoard = (boardId: string, newName: string): Promise<Board | null> => {
    return runMutation(async () => {
      const result = await invoke<BoardMutationResult>('duplicate_board', { boardId, newName });
      applyIndex(result.index);
      return result.board;
    }, null);
  };

  const saveBoardData = useCallback(
    (boardId: string, data: ExcalidrawData): Promise<boolean> =>
      runMutation(async () => {
        await invoke('save_board_data', { boardId, data: JSON.stringify(data) });
        return true;
      }, false),
    [runMutation],
  );

  const loadBoardData = useCallback(async (boardId: string): Promise<ExcalidrawData | null> => {
    try {
      const dataStr = await invoke<string | null>('load_board_data', { boardId });
      if (!dataStr) {
        return null;
      }
      // Deserialize JSON string to ExcalidrawData
      const data = JSON.parse(dataStr) as ExcalidrawData;
      return data;
    } catch (e) {
      // If parsing fails, return null (might be first load or corrupted data)
      console.error('Failed to load board data:', e);
      return null;
    }
  }, []);

  const saveBoardThumbnail = useCallback(
    async (boardId: string, thumbnail: string | null): Promise<boolean> => {
      try {
        await invoke('save_board_thumbnail', { boardId, thumbnail });
        return true;
      } catch (e) {
        console.error('Failed to save board thumbnail:', e);
        return false;
      }
    },
    [],
  );

  return {
    items,
    activeBoardId,
    loading,
    error,
    loadBoards,
    applyBoardsIndex: applyIndex,
    createBoard,
    renameBoard,
    deleteBoard,
    setActiveBoard,
    duplicateBoard,
    setBoardsIndex: (nextItems: BoardListItem[]): Promise<boolean> =>
      runMutation(async () => {
        const index = await invoke<BoardsIndex>('set_boards_index', { items: nextItems });
        applyIndex(index);
        return true;
      }, false),
    saveBoardData,
    loadBoardData,
    saveBoardThumbnail,
  };
}
