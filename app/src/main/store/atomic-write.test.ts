import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renameSyncWithRetry, writeFileAtomic } from './atomic-write';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pf-atomic-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('writeFileAtomic', () => {
  it('creates missing folders, writes, and replaces an existing file without leaving temp files', async () => {
    const file = join(dir, 'a', 'b', 'cache.json');
    await writeFileAtomic(file, 'one');
    await writeFileAtomic(file, 'two');
    expect(readFileSync(file, 'utf8')).toBe('two');
    expect(readdirSync(join(dir, 'a', 'b'))).toEqual(['cache.json']);
  });

  it('concurrent writers never share a temp file; the last rename wins whole', async () => {
    const file = join(dir, 'cache.json');
    await Promise.all(['x'.repeat(50_000), 'y'.repeat(50_000), 'z'.repeat(50_000)].map((d) => writeFileAtomic(file, d)));
    expect(readFileSync(file, 'utf8')).toMatch(/^(x{50000}|y{50000}|z{50000})$/);
    expect(readdirSync(dir)).toEqual(['cache.json']);
  });

  it('rejects when the rename cannot succeed, and removes its temp file', async () => {
    const file = join(dir, 'taken');
    mkdirSync(join(file, 'inside'), { recursive: true }); // a non-empty folder in the way
    await expect(writeFileAtomic(file, 'data', { backoffMs: 1 })).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(['taken']);
  });
});

describe('renameSyncWithRetry', () => {
  const eperm = () => Object.assign(new Error('EPERM'), { code: 'EPERM' });

  it('retries a transient EPERM with growing backoff, then succeeds', () => {
    let calls = 0;
    const sleeps: number[] = [];
    renameSyncWithRetry('a', 'b', {
      rename: () => {
        calls += 1;
        if (calls < 3) throw eperm();
      },
      sleep: (ms) => sleeps.push(ms),
    });
    expect(calls).toBe(3);
    expect(sleeps).toEqual([40, 80]);
  });

  it('gives up after `retries` and rethrows the last error', () => {
    let calls = 0;
    expect(() =>
      renameSyncWithRetry('a', 'b', {
        retries: 2,
        rename: () => {
          calls += 1;
          throw eperm();
        },
        sleep: () => undefined,
      }),
    ).toThrow('EPERM');
    expect(calls).toBe(3);
  });

  it('does not retry a non-transient error', () => {
    let calls = 0;
    expect(() =>
      renameSyncWithRetry('a', 'b', {
        rename: () => {
          calls += 1;
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        },
        sleep: () => undefined,
      }),
    ).toThrow('ENOENT');
    expect(calls).toBe(1);
  });
});
