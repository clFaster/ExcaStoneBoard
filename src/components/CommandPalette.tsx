import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './CommandPalette.css';

export interface CommandPaletteItem {
  id: string;
  label: string;
  description?: string;
  keywords?: string;
  shortcut?: string;
  disabled?: boolean;
  action: () => void | Promise<void>;
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
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  const runCommand = useCallback(
    (command: CommandPaletteItem | undefined) => {
      if (!command || command.disabled) {
        return;
      }

      onClose();
      void Promise.resolve(command.action());
    },
    [onClose],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
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
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        if (activeIndex >= 0) {
          runCommand(filteredCommands[activeIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeIndex, filteredCommands, onClose, runCommand]);

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
            placeholder="Search commands or boards..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="command-palette-list" role="listbox" aria-label="Command results">
          {filteredCommands.length === 0 ? (
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
                {command.shortcut ? (
                  <span className="command-palette-item-shortcut">{command.shortcut}</span>
                ) : null}
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
