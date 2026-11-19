import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PORTABLE_MARKER, portableUserDataDir } from './portable';

describe('portableUserDataDir', () => {
  const exe = path.join('X:', 'apps', 'Proxy Farm', 'Proxy Farm.exe');
  const dir = path.dirname(exe);

  it('uses <exe dir>/data when the marker file is next to the packaged exe', () => {
    const exists = (p: string) => p === path.join(dir, PORTABLE_MARKER);
    expect(portableUserDataDir(true, exe, exists)).toBe(path.join(dir, 'data'));
  });

  it('is undefined without the marker (normal install)', () => {
    expect(portableUserDataDir(true, exe, () => false)).toBeUndefined();
  });

  it('never applies to a dev run, even with a marker', () => {
    expect(portableUserDataDir(false, exe, () => true)).toBeUndefined();
  });
});
