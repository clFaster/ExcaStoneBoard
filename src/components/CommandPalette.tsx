import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, Dispatch, MouseEvent, RefObject, SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import './CommandPalette.css';

export interface CommandPaletteItem {
  id: string;
  label: string;
  description?: string;
  keywords?: string;
  disabled?: boolean;
  children?: CommandPaletteItem[];
  searchPlaceholder?: string;
  emptyStateMessage?: string;
  input?: {
    placeholder: string;
    initialValue?: string;
    submitHint?: string;
  };
  action: (inputValue?: string) => void | Promise<void>;
}

interface CommandPaletteProps {
  onClose: () => void;
  commands: CommandPaletteItem[];
}

interface RunCommandArgs {
  command: CommandPaletteItem | undefined;
  providedInput?: string;
  setActiveCommandId: Dispatch<SetStateAction<string | null>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  setInputCommandId: Dispatch<SetStateAction<string | null>>;
  setInputValue: Dispatch<SetStateAction<string>>;
  onClose: () => void;
}

interface KeyboardContext {
  activeCommand: CommandPaletteItem | null;
  inputCommand: CommandPaletteItem | null;
  inputValue: string;
  activeIndex: number;
  filteredCommands: CommandPaletteItem[];
  clearCommandGroup: () => void;
  clearInputMode: () => void;
  setKeyboardNavigationActive: Dispatch<SetStateAction<boolean>>;
  runCommand: (command: CommandPaletteItem | undefined, providedInput?: string) => void;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  onClose: () => void;
}

interface CommandPaletteResultsProps {
  activeCommand: CommandPaletteItem | null;
  inputCommand: CommandPaletteItem | null;
  filteredCommands: CommandPaletteItem[];
  activeIndex: number;
  keyboardNavigationActive: boolean;
  onSelectIndex: (index: number) => void;
  onRunCommand: (command: CommandPaletteItem) => void;
}

interface CommandPaletteDialogProps {
  inputRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  activeCommand: CommandPaletteItem | null;
  inputCommand: CommandPaletteItem | null;
  inputValue: string;
  query: string;
  setActiveInputValue: Dispatch<SetStateAction<string>>;
  filteredCommands: CommandPaletteItem[];
  activeIndex: number;
  keyboardNavigationActive: boolean;
  setKeyboardNavigationActive: Dispatch<SetStateAction<boolean>>;
  setSelectedIndex: Dispatch<SetStateAction<number>>;
  runCommand: (command: CommandPaletteItem | undefined, providedInput?: string) => void;
}

const normalize = (value: string) => value.trim().toLowerCase();
const isEscapeKey = (event: KeyboardEvent) => event.key === 'Escape';
const isEnterKey = (event: KeyboardEvent) => event.key === 'Enter';
const isArrowUpKey = (event: KeyboardEvent) => event.key === 'ArrowUp';
const isArrowDownKey = (event: KeyboardEvent) => event.key === 'ArrowDown';

const commandMatchesQuery = (command: CommandPaletteItem, query: string) => {
  if (!query) {
    return true;
  }

  const haystack =
    `${command.label} ${command.description ?? ''} ${command.keywords ?? ''}`.toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  return terms.every((term) => haystack.includes(term));
};

const getActiveIndex = (selectedIndex: number, commandsCount: number) => {
  if (commandsCount === 0) {
    return -1;
  }

  return Math.min(selectedIndex, commandsCount - 1);
};

const getWrappedSelectionIndex = (
  current: number,
  commandsCount: number,
  direction: 'up' | 'down',
) => {
  if (commandsCount === 0) {
    return 0;
  }

  const normalized = Math.min(current, commandsCount - 1);
  if (direction === 'down') {
    return (normalized + 1) % commandsCount;
  }

  return (normalized - 1 + commandsCount) % commandsCount;
};

const focusInputOnAnimationFrame = (
  inputRef: RefObject<HTMLInputElement | null>,
  selectText = false,
) => {
  return window.requestAnimationFrame(() => {
    inputRef.current?.focus();
    if (selectText) {
      inputRef.current?.select();
    }
  });
};

const runCommandAction = ({
  command,
  providedInput,
  setActiveCommandId,
  setQuery,
  setSelectedIndex,
  setInputCommandId,
  setInputValue,
  onClose,
}: RunCommandArgs) => {
  if (!command || command.disabled) {
    return;
  }

  if (command.children && command.children.length > 0 && typeof providedInput !== 'string') {
    setActiveCommandId(command.id);
    setQuery('');
    setSelectedIndex(0);
    setInputCommandId(null);
    setInputValue('');
    return;
  }

  if (command.input && typeof providedInput !== 'string') {
    setInputCommandId(command.id);
    setInputValue(command.input.initialValue ?? '');
    return;
  }

  onClose();
  void Promise.resolve(command.action(providedInput?.trim()));
};

const tryHandleEscape = (event: KeyboardEvent, context: KeyboardContext) => {
  if (!isEscapeKey(event)) {
    return false;
  }

  event.preventDefault();
  if (context.inputCommand) {
    context.clearInputMode();
  } else if (context.activeCommand) {
    context.clearCommandGroup();
  } else {
    context.onClose();
  }

  return true;
};

const tryHandleEnter = (event: KeyboardEvent, context: KeyboardContext) => {
  if (!isEnterKey(event)) {
    return false;
  }

  event.preventDefault();
  if (context.inputCommand) {
    if (context.inputValue.trim()) {
      context.runCommand(context.inputCommand, context.inputValue);
    }
    return true;
  }

  if (context.activeIndex >= 0) {
    context.runCommand(context.filteredCommands[context.activeIndex]);
  }

  return true;
};

const tryHandleArrowNavigation = (event: KeyboardEvent, context: KeyboardContext) => {
  if (!isArrowDownKey(event) && !isArrowUpKey(event)) {
    return false;
  }

  event.preventDefault();
  context.setKeyboardNavigationActive(true);
  const direction = isArrowDownKey(event) ? 'down' : 'up';
  context.setSelectedIndex((current) =>
    getWrappedSelectionIndex(current, context.filteredCommands.length, direction),
  );
  return true;
};

const handlePaletteKeyDown = (event: KeyboardEvent, context: KeyboardContext) => {
  if (tryHandleEscape(event, context)) {
    return;
  }

  if (tryHandleEnter(event, context)) {
    return;
  }

  if (context.inputCommand) {
    return;
  }

  tryHandleArrowNavigation(event, context);
};

const useCommandPaletteKeyboard = ({
  activeCommand,
  inputCommand,
  inputValue,
  activeIndex,
  filteredCommands,
  clearCommandGroup,
  clearInputMode,
  setKeyboardNavigationActive,
  runCommand,
  setSelectedIndex,
  onClose,
}: KeyboardContext) => {
  useEffect(() => {
    const context: KeyboardContext = {
      activeCommand,
      inputCommand,
      inputValue,
      activeIndex,
      filteredCommands,
      clearCommandGroup,
      clearInputMode,
      setKeyboardNavigationActive,
      runCommand,
      setSelectedIndex,
      onClose,
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      handlePaletteKeyDown(event, context);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    activeCommand,
    activeIndex,
    clearCommandGroup,
    clearInputMode,
    filteredCommands,
    inputCommand,
    inputValue,
    onClose,
    runCommand,
    setKeyboardNavigationActive,
    setSelectedIndex,
  ]);
};

const getEmptyStateMessage = (inputCommand: CommandPaletteItem | null) =>
  inputCommand?.input?.submitHint ?? 'Press Enter to confirm or Escape to go back.';

function CommandPaletteResults({
  activeCommand,
  inputCommand,
  filteredCommands,
  activeIndex,
  keyboardNavigationActive,
  onSelectIndex,
  onRunCommand,
}: CommandPaletteResultsProps) {
  if (inputCommand) {
    return <div className="command-palette-empty">{getEmptyStateMessage(inputCommand)}</div>;
  }

  if (filteredCommands.length === 0) {
    return (
      <div className="command-palette-empty">
        {activeCommand?.emptyStateMessage ?? 'No matching commands.'}
      </div>
    );
  }

  return (
    <>
      {filteredCommands.map((command, index) => (
        <button
          key={command.id}
          type="button"
          className={`command-palette-item ${index === activeIndex ? 'active' : ''}`}
          data-testid={`command-palette-item-${command.id}`}
          onMouseEnter={() => {
            if (!keyboardNavigationActive) {
              onSelectIndex(index);
            }
          }}
          onClick={() => onRunCommand(command)}
          role="option"
          aria-selected={index === activeIndex}
          disabled={command.disabled}
        >
          <span className="command-palette-item-body">
            <span className="command-palette-item-label">{command.label}</span>
            {command.description ? (
              <span className="command-palette-item-description">{command.description}</span>
            ) : null}
          </span>
        </button>
      ))}
    </>
  );
}

function CommandPaletteDialog({
  inputRef,
  listRef,
  activeCommand,
  inputCommand,
  inputValue,
  query,
  setActiveInputValue,
  filteredCommands,
  activeIndex,
  keyboardNavigationActive,
  setKeyboardNavigationActive,
  setSelectedIndex,
  runCommand,
}: CommandPaletteDialogProps) {
  const placeholder =
    inputCommand?.input?.placeholder ??
    activeCommand?.searchPlaceholder ??
    'Search commands or boards...';
  const activeValue = inputCommand ? inputValue : query;
  const footerText =
    inputCommand || activeCommand
      ? 'Enter to confirm | Esc to go back'
      : 'Ctrl+Shift+P / Cmd+Shift+P';

  const handleInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setActiveInputValue(event.target.value);
    },
    [setActiveInputValue],
  );

  return (
    <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="command-palette-input-row">
        <input
          ref={inputRef}
          type="text"
          className="command-palette-input"
          data-testid="command-palette-input"
          placeholder={placeholder}
          value={activeValue}
          onChange={handleInputChange}
        />
      </div>

      <div
        ref={listRef}
        className="command-palette-list"
        role="listbox"
        aria-label="Command results"
        onMouseMove={() => setKeyboardNavigationActive(false)}
      >
        <CommandPaletteResults
          activeCommand={activeCommand}
          inputCommand={inputCommand}
          filteredCommands={filteredCommands}
          activeIndex={activeIndex}
          keyboardNavigationActive={keyboardNavigationActive}
          onSelectIndex={setSelectedIndex}
          onRunCommand={runCommand}
        />
      </div>

      <div className="command-palette-footer">{footerText}</div>
    </div>
  );
}

export function CommandPalette({ onClose, commands }: CommandPaletteProps) {
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputCommandId, setInputCommandId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [keyboardNavigationActive, setKeyboardNavigationActive] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const activeCommand = useMemo(
    () =>
      activeCommandId ? (commands.find((command) => command.id === activeCommandId) ?? null) : null,
    [commands, activeCommandId],
  );

  const visibleCommands = useMemo(
    () => activeCommand?.children ?? commands,
    [activeCommand, commands],
  );

  const inputCommand = useMemo(
    () =>
      inputCommandId
        ? (visibleCommands.find((command) => command.id === inputCommandId) ?? null)
        : null,
    [visibleCommands, inputCommandId],
  );

  const filteredCommands = useMemo(() => {
    const normalizedQuery = normalize(query);
    return visibleCommands.filter((command) => commandMatchesQuery(command, normalizedQuery));
  }, [visibleCommands, query]);

  const activeIndex = useMemo(
    () => getActiveIndex(selectedIndex, filteredCommands.length),
    [selectedIndex, filteredCommands.length],
  );

  const runCommand = useCallback(
    (command: CommandPaletteItem | undefined, providedInput?: string) => {
      runCommandAction({
        command,
        providedInput,
        setActiveCommandId,
        setQuery,
        setSelectedIndex,
        setInputCommandId,
        setInputValue,
        onClose,
      });
    },
    [onClose],
  );

  const clearInputMode = useCallback(() => {
    setInputCommandId(null);
    setInputValue('');
  }, []);

  const clearCommandGroup = useCallback(() => {
    setActiveCommandId(null);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  const setActiveInputValue = inputCommand ? setInputValue : setQuery;

  useCommandPaletteKeyboard({
    activeCommand,
    inputCommand,
    inputValue,
    activeIndex,
    filteredCommands,
    clearCommandGroup,
    clearInputMode,
    setKeyboardNavigationActive,
    runCommand,
    setSelectedIndex,
    onClose,
  });

  useEffect(() => {
    const frameId = focusInputOnAnimationFrame(inputRef);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    if (!inputCommand) {
      return;
    }

    const frameId = focusInputOnAnimationFrame(inputRef, true);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [inputCommand]);

  useEffect(() => {
    if (inputCommand || activeIndex < 0) {
      return;
    }

    const listElement = listRef.current;
    if (!listElement) {
      return;
    }

    const activeElement = listElement.querySelector<HTMLElement>('.command-palette-item.active');
    activeElement?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, inputCommand, filteredCommands]);

  const handleOverlayMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  return createPortal(
    <div className="command-palette-overlay" onMouseDown={handleOverlayMouseDown}>
      <CommandPaletteDialog
        inputRef={inputRef}
        listRef={listRef}
        activeCommand={activeCommand}
        inputCommand={inputCommand}
        inputValue={inputValue}
        query={query}
        setActiveInputValue={setActiveInputValue}
        filteredCommands={filteredCommands}
        activeIndex={activeIndex}
        keyboardNavigationActive={keyboardNavigationActive}
        setKeyboardNavigationActive={setKeyboardNavigationActive}
        setSelectedIndex={setSelectedIndex}
        runCommand={runCommand}
      />
    </div>,
    document.body,
  );
}
