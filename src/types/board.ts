import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';

export interface Board {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  collaboration_link: string | null;
  thumbnail: string | null;
}

export interface BoardListBoard extends Board {
  type: 'board';
}

export interface BoardFolder {
  type: 'folder';
  id: string;
  name: string;
  items: Board[];
}

export type BoardListItem = BoardListBoard | BoardFolder;

export interface BoardsIndex {
  items: BoardListItem[];
  active_board_id: string | null;
}

export interface BoardsExportEntry {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  collaboration_link: string | null;
  thumbnail: string | null;
  data: ExcalidrawData | null;
}

export interface BoardsExportFile {
  version: 1;
  exported_at: string;
  boards: BoardsExportEntry[];
}

export interface BoardsImportResult {
  imported: number;
  skipped: number;
}

export interface ExcalidrawData {
  elements: ExcalidrawElement[];
  appState?: Partial<AppState>;
  files?: BinaryFiles;
}

// Legacy format for migration if needed
export interface LegacyBoardData {
  excalidraw: string | null;
  'excalidraw-state': string | null;
}
