import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { BoardListItem } from '../types/board';

const filterBoardItems = (items: BoardListItem[], normalizedQuery: string): BoardListItem[] => {
  if (!normalizedQuery) return items;

  return items.reduce<BoardListItem[]>((matches, item) => {
    if (item.type === 'board') {
      if (item.name.toLocaleLowerCase().includes(normalizedQuery)) matches.push(item);
      return matches;
    }

    if (item.name.toLocaleLowerCase().includes(normalizedQuery)) {
      matches.push(item);
      return matches;
    }

    const matchingBoards = item.items.filter((board) =>
      board.name.toLocaleLowerCase().includes(normalizedQuery),
    );
    if (matchingBoards.length > 0) matches.push({ ...item, items: matchingBoards });
    return matches;
  }, []);
};

const countBoards = (items: BoardListItem[]) =>
  items.reduce((count, item) => count + (item.type === 'folder' ? item.items.length : 1), 0);

export const useBoardSearch = (items: BoardListItem[], sidebarCollapsed: boolean) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const isFiltering = normalizedSearchQuery.length > 0;
  const filteredItems = useMemo(
    () => filterBoardItems(items, normalizedSearchQuery),
    [items, normalizedSearchQuery],
  );
  const filteredBoardCount = useMemo(() => countBoards(filteredItems), [filteredItems]);

  const clearSearch = useCallback(() => setSearchQuery(''), []);
  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    clearSearch();
  }, [clearSearch]);
  const toggleSearch = useCallback(() => {
    setIsSearchOpen((open) => {
      if (open) clearSearch();
      return !open;
    });
  }, [clearSearch]);
  const handleSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeSearch();
    },
    [closeSearch],
  );

  useEffect(() => {
    if (isSearchOpen && !sidebarCollapsed) searchInputRef.current?.focus();
  }, [isSearchOpen, sidebarCollapsed]);

  useEffect(() => {
    const openSearch = () => {
      searchInputRef.current?.focus();
      setIsSearchOpen(true);
    };
    window.addEventListener('boardlist:open-search', openSearch);
    return () => window.removeEventListener('boardlist:open-search', openSearch);
  }, []);

  return {
    clearSearch,
    filteredBoardCount,
    filteredItems,
    handleSearchKeyDown,
    isFiltering,
    isSearchOpen,
    searchInputRef,
    searchQuery,
    setSearchQuery,
    toggleSearch,
  };
};
