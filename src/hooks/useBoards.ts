import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Board, BoardsIndex, BoardListItem, ExcalidrawData } from '../types/board';

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
    loadBoards();
  }, [loadBoards]);

  const createBoard = async (name: string): Promise<Board | null> => {
    try {
      const board = await invoke<Board>('create_board', { name });
      await loadBoards();
      return board;
    } catch (e) {
      setError(String(e));
      return null;
    }
  };

  const renameBoard = async (boardId: string, newName: string): Promise<boolean> => {
    try {
      await invoke<Board>('rename_board', { boardId, newName });
      await loadBoards();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };

  const deleteBoard = async (boardId: string): Promise<boolean> => {
    try {
      await invoke('delete_board', { boardId });
      await loadBoards();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };

  const setActiveBoard = async (boardId: string): Promise<boolean> => {
    try {
      await invoke('set_active_board', { boardId });
      setActiveBoardId(boardId);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  };

  const duplicateBoard = async (boardId: string, newName: string): Promise<Board | null> => {
    try {
      const board = await invoke<Board>('duplicate_board', { boardId, newName });
      await loadBoards();
      return board;
    } catch (e) {
      setError(String(e));
      return null;
    }
  };


  const saveBoardData = useCallback(async (boardId: string, data: ExcalidrawData): Promise<boolean> => {
    try {
      // Serialize ExcalidrawData to JSON string for storage
      const dataStr = JSON.stringify(data);
      await invoke('save_board_data', { boardId, data: dataStr });
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }, []);

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

  return {
    items,
    activeBoardId,
    loading,
    error,
    loadBoards,
    createBoard,
    renameBoard,
    deleteBoard,
    setActiveBoard,
    duplicateBoard,
    setBoardsIndex: async (nextItems: BoardListItem[]): Promise<boolean> => {
      try {
        const index = await invoke<BoardsIndex>('set_boards_index', { items: nextItems });
        setItems(index.items);
        setActiveBoardId(index.active_board_id);
        return true;
      } catch (e) {
        setError(String(e));
        return false;
      }
    },
    saveBoardData,
    loadBoardData,
  };
}
