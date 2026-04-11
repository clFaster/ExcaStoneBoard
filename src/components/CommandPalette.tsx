import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './CommandPalette.css';

export interface CommandPaletteItem {
  id: string;
  label: string;
  description?: string;
  keywords?: string;
  disabled?: boolean;
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

const normalize = (value: string) => value.trim().toLowerCase();

const commandMatchesQuery = (command: CommandPaletteItem, query: string) => {
  if (!query) {
    return true;
  }

  const haystack =
    `${command.label} ${command.description ?? ''} ${command.keywords ?? ''}`.toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);

  return terms.every((term) => haystack.includes(term));
};

export function CommandPalette({ onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputCommandId, setInputCommandId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const inputCommand = useMemo(
    () =>
      inputCommandId ? commands.find((command) => command.id === inputCommandId) ?? null : null,
    [commands, inputCommandId],
  );

  const filteredCommands = useMemo(() => {
    const normalizedQuery = normalize(query);
    return commands.filter((command) => commandMatchesQuery(command, normalizedQuery));
  }, [commands, query]);

  const activeIndex =
    filteredCommands.length === 0 ? -1 : Math.min(selectedIndex, filteredCommands.length - 1);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    if (!inputCommand) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [inputCommand]);

  const runCommand = useCallback(
    (command: CommandPaletteItem | undefined, providedInput?: string) => {
      if (!command || command.disabled) {
        return;
      }

      if (command.input && typeof providedInput !== 'string') {
        setInputCommandId(command.id);
        setInputValue(command.input.initialValue ?? '');
        return;
      }

      onClose();
      void Promise.resolve(command.action(providedInput?.trim()));
    },
    [onClose],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (inputCommand) {
          setInputCommandId(null);
          setInputValue('');
        } else {
          onClose();
        }
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        if (inputCommand) {
          if (inputValue.trim()) {
            runCommand(inputCommand, inputValue);
          }
          return;
        }
        if (activeIndex >= 0) {
          runCommand(filteredCommands[activeIndex]);
        }
        return;
      }

      if (inputCommand) {
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((current) => {
          if (filteredCommands.length === 0) {
            return 0;
          }
          const normalized = Math.min(current, filteredCommands.length - 1);
          return (normalized + 1) % filteredCommands.length;
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((current) => {
          if (filteredCommands.length === 0) {
            return 0;
          }
          const normalized = Math.min(current, filteredCommands.length - 1);
          return (normalized - 1 + filteredCommands.length) % filteredCommands.length;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeIndex, filteredCommands, inputCommand, inputValue, onClose, runCommand]);

  return createPortal(
    <div
      className="command-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="command-palette-input-row">
          <input
            ref={inputRef}
            type="text"
            className="command-palette-input"
            placeholder={inputCommand?.input?.placeholder ?? 'Search commands or boards...'}
            value={inputCommand ? inputValue : query}
            onChange={(event) => {
              if (inputCommand) {
                setInputValue(event.target.value);
                return;
              }
              setQuery(event.target.value);
            }}
          />
        </div>

        <div className="command-palette-list" role="listbox" aria-label="Command results">
          {inputCommand ? (
            <div className="command-palette-empty">
              {inputCommand.input?.submitHint ?? 'Press Enter to confirm or Escape to go back.'}
            </div>
          ) : filteredCommands.length === 0 ? (
            <div className="command-palette-empty">No matching commands.</div>
          ) : (
            filteredCommands.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className={`command-palette-item ${index === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setSelectedIndex(index)}
                onClick={() => runCommand(command)}
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
            ))
          )}
        </div>

        <div className="command-palette-footer">Ctrl+Shift+P / Cmd+Shift+P</div>
      </div>
    </div>,
    document.body,
  );
}
