declare module '@tauri-apps/plugin-opener' {
  export interface OpenOptions {
    openWith?: string;
  }

  export function open(target: string, options?: OpenOptions): Promise<void>;
}
