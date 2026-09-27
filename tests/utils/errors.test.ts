import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runHook } from '../../src/utils/errors';

describe('runHook — fail-open wrapper', () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string) => {
    throw new Error(`process.exit(${String(_code ?? '')})`);
  });

  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  beforeEach(() => {
    exitSpy.mockClear();
    stderrSpy.mockClear();
  });

  it('exits 0 when hook body returns 0', async () => {
    await expect(runHook('test-hook', async () => 0)).rejects.toThrow('process.exit(0)');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('exits 2 when hook body intentionally returns 2 (BLOCK)', async () => {
    await expect(runHook('test-hook', async () => 2)).rejects.toThrow('process.exit(2)');
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it('exits 0 (fail-open) on internal crash — never exit 2', async () => {
    await expect(
      runHook('test-hook', async () => {
        throw new Error('unexpected internal error');
      }),
    ).rejects.toThrow('process.exit(0)');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('writes hook name and error message to stderr on crash', async () => {
    await expect(
      runHook('crashing-hook', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow();
    const output = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(output).toContain('crashing-hook');
    expect(output).toContain('boom');
  });
});
