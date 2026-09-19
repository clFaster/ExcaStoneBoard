import type { KeyboardEvent, RefObject } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChevronRight,
  faCopy,
  faFileCode,
  faFileImage,
  faMagnifyingGlass,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import type { Board } from '../types/board';

interface BoardSearchToggleProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function BoardSearchToggle({ isOpen, onToggle }: BoardSearchToggleProps) {
  const label = isOpen ? 'Hide search' : 'Search boards';

  return (
    <button
      className={`icon-btn ${isOpen ? 'active' : ''}`}
      data-testid="toggle-search-btn"
      onClick={onToggle}
      title={label}
      aria-label={label}
      aria-pressed={isOpen}
    >
      <FontAwesomeIcon icon={faMagnifyingGlass} />
    </button>
  );
}

interface BoardSearchProps {
  count: number;
  inputRef: RefObject<HTMLInputElement | null>;
  isFiltering: boolean;
  isOpen: boolean;
  onChange: (query: string) => void;
  onClear: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  query: string;
}

export function BoardSearch({
  count,
  inputRef,
  isFiltering,
  isOpen,
  onChange,
  onClear,
  onKeyDown,
  query,
}: BoardSearchProps) {
  if (!isOpen) return null;
  const status = isFiltering ? `${count} ${count === 1 ? 'match' : 'matches'}` : '';

  return (
    <div className="board-search" role="search">
      <FontAwesomeIcon className="board-search-icon" icon={faMagnifyingGlass} />
      <input
        ref={inputRef}
        type="search"
        data-testid="board-search-input"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Filter boards..."
        aria-label="Filter boards"
        className="board-search-input"
      />
      {isFiltering && (
        <button
          type="button"
          className="board-search-clear"
          data-testid="board-search-clear"
          onClick={onClear}
          aria-label="Clear board filter"
          title="Clear filter"
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      )}
      <span className="board-search-status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}

interface BoardListEmptyStateProps {
  hasBoards: boolean;
  hasMatches: boolean;
  onClearFilter: () => void;
}

export function BoardListEmptyState({
  hasBoards,
  hasMatches,
  onClearFilter,
}: BoardListEmptyStateProps) {
  if (!hasBoards) {
    return (
      <div className="no-boards">
        <p>No boards yet</p>
        <p className="hint">Create a new board to get started</p>
      </div>
    );
  }

  if (hasMatches) return null;
  return (
    <div className="no-boards" data-testid="board-search-empty">
      <p>No matching boards</p>
      <p className="hint">Try another board or folder name</p>
      <button type="button" className="clear-filter-btn" onClick={onClearFilter}>
        Clear filter
      </button>
    </div>
  );
}

interface BoardExportActionsProps {
  disabled: boolean;
  hidden: boolean;
  onCopyPng: () => void;
  onExportPng: () => void;
  onExportSvg: () => void;
}

export function BoardExportActions({
  disabled,
  hidden,
  onCopyPng,
  onExportPng,
  onExportSvg,
}: BoardExportActionsProps) {
  if (hidden) return null;

  return (
    <div className="board-export-actions">
      <button
        type="button"
        className="export-btn"
        onClick={onExportPng}
        disabled={disabled}
        title="Export PNG"
        aria-label="Export PNG"
      >
        <FontAwesomeIcon icon={faFileImage} />
      </button>
      <button
        type="button"
        className="export-btn"
        onClick={onCopyPng}
        disabled={disabled}
        title="Copy PNG"
        aria-label="Copy PNG"
      >
        <FontAwesomeIcon icon={faCopy} />
      </button>
      <button
        type="button"
        className="export-btn"
        onClick={onExportSvg}
        disabled={disabled}
        title="Export SVG"
        aria-label="Export SVG"
      >
        <FontAwesomeIcon icon={faFileCode} />
      </button>
    </div>
  );
}

interface CollapsedBoardListProps {
  activeBoardId: string | null;
  boards: { board: Board }[];
  onExpand: () => void;
  onSelectBoard: (boardId: string) => void;
}

export function CollapsedBoardList({
  activeBoardId,
  boards,
  onExpand,
  onSelectBoard,
}: CollapsedBoardListProps) {
  return (
    <div className="board-list collapsed">
      <button className="toggle-btn" onClick={onExpand} title="Expand sidebar">
        <FontAwesomeIcon icon={faChevronRight} />
      </button>
      <div className="collapsed-boards">
        {boards.map(({ board }) => (
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
