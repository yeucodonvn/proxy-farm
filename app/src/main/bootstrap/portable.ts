import path from 'node:path';

/** Name of the marker file that turns a packaged app folder into a portable install. */
export const PORTABLE_MARKER = 'portable';

/**
 * The userData dir of a portable build: `<exe dir>/data` when a `portable` marker file
 * sits next to the packaged exe, else undefined (normal install, data in %APPDATA%).
 * Never applies to a dev run (`isPackaged` false), whose exe is electron.exe in
 * node_modules.
 */
export function portableUserDataDir(isPackaged: boolean, execPath: string, exists: (p: string) => boolean): string | undefined {
  if (!isPackaged) return undefined;
  const dir = path.dirname(execPath);
  return exists(path.join(dir, PORTABLE_MARKER)) ? path.join(dir, 'data') : undefined;
}
