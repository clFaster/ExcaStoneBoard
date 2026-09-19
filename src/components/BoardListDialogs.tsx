import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowUpRightFromSquare, faDownload, faUpload } from '@fortawesome/free-solid-svg-icons';

const formatAppVersion = (version: string | null) => {
  if (!version) return 'Loading...';
  return version === 'Unknown' ? version : `v${version}`;
};

interface SettingsDialogProps {
  appVersion: string | null;
  boardsExporting: boolean;
  boardsImporting: boolean;
  hideExportRow: boolean;
  importDialogOpen: boolean;
  importError: string | null;
  isOpen: boolean;
  onClose: () => void;
  onExportBoards: () => Promise<void>;
  onHideExportRowChange: (value: boolean) => void;
  onOpenImport: () => void;
  onOpenReleases: () => void;
  onShowTimestampsChange: (value: boolean) => void;
  showTimestamps: boolean;
}

export function SettingsDialog({
  appVersion,
  boardsExporting,
  boardsImporting,
  hideExportRow,
  importDialogOpen,
  importError,
  isOpen,
  onClose,
  onExportBoards,
  onHideExportRowChange,
  onOpenImport,
  onOpenReleases,
  onShowTimestampsChange,
  showTimestamps,
}: SettingsDialogProps) {
  if (!isOpen) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
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
              onClick={onOpenImport}
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
              onChange={(event) => onHideExportRowChange(event.target.checked)}
            />
            <span className="toggle-track" aria-hidden="true"></span>
            <span className="toggle-text">Hide export/copy buttons</span>
          </label>
        </div>
        {!importDialogOpen && importError && <div className="settings-error">{importError}</div>}
        <div className="settings-section">
          <div className="settings-section-title">Sidebar</div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              data-testid="toggle-show-timestamps"
              checked={showTimestamps}
              onChange={(event) => onShowTimestampsChange(event.target.checked)}
            />
            <span className="toggle-track" aria-hidden="true"></span>
            <span className="toggle-text">Show timestamps in sidebar</span>
          </label>
        </div>
        <div className="settings-version-row">
          <span className="settings-version-label">Version</span>
          <button type="button" className="settings-version-link" onClick={onOpenReleases}>
            {formatAppVersion(appVersion)}
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
          </button>
        </div>
        <div className="modal-actions">
          <button className="cancel-btn" data-testid="close-settings-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface ImportBoardDialogEntry {
  id?: string;
  key: string;
  name: string;
}

interface ImportDialogProps {
  boardsImporting: boolean;
  duplicateImportIds: Set<string>;
  error: string | null;
  existingBoardIds: Set<string>;
  importBoards: ImportBoardDialogEntry[];
  importSelection: Record<string, boolean>;
  isOpen: boolean;
  onClearAll: () => void;
  onClose: () => void;
  onConfirm: () => void;
  onSelectAll: () => void;
  onToggleSelection: (key: string) => void;
  selectedCount: number;
  sourceName: string | null;
}

export function ImportDialog({
  boardsImporting,
  duplicateImportIds,
  error,
  existingBoardIds,
  importBoards,
  importSelection,
  isOpen,
  onClearAll,
  onClose,
  onConfirm,
  onSelectAll,
  onToggleSelection,
  selectedCount,
  sourceName,
}: ImportDialogProps) {
  if (!isOpen) return null;

  const handleOverlayClick = () => {
    if (!boardsImporting) onClose();
  };

  return createPortal(
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal import-modal" onClick={(event) => event.stopPropagation()}>
        <h3>Import boards</h3>
        {sourceName && <p className="modal-hint">Source: {sourceName}</p>}
        <div className="import-controls">
          <button
            type="button"
            className="import-control-btn"
            onClick={onSelectAll}
            disabled={boardsImporting}
          >
            Select all
          </button>
          <button
            type="button"
            className="import-control-btn"
            onClick={onClearAll}
            disabled={boardsImporting}
          >
            Clear
          </button>
        </div>
        <div className="import-list">
          {importBoards.map((entry) => {
            const isSelected = Boolean(importSelection[entry.key]);
            const entryId = entry.id;
            const isDuplicate = Boolean(
              entryId && (existingBoardIds.has(entryId) || duplicateImportIds.has(entryId)),
            );
            return (
              <label
                key={entry.key}
                className={`import-item ${isSelected ? 'selected' : ''} ${isDuplicate ? 'duplicate' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelection(entry.key)}
                  disabled={boardsImporting}
                />
                <span className="import-checkmark" aria-hidden="true"></span>
                <span className="import-item-name">{entry.name}</span>
                {isDuplicate && <span className="import-item-duplicate">Duplicate</span>}
              </label>
            );
          })}
        </div>
        <div className="import-summary">{selectedCount} selected</div>
        {error && <div className="import-error">{error}</div>}
        <div className="modal-actions">
          <button className="cancel-btn" onClick={onClose} disabled={boardsImporting}>
            Cancel
          </button>
          <button
            className="save-btn"
            onClick={onConfirm}
            disabled={boardsImporting || selectedCount === 0}
          >
            Import
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
