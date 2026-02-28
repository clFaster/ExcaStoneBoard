declare module '@tauri-apps/plugin-opener' {
  export function openUrl(url: string | URL, openWith?: string): Promise<void>;
}
