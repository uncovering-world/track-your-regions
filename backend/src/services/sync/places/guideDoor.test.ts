/**
 * Whether a kind's guide door is open: the source's curator gate and the
 * Wikivoyage usage build, the one place that is decided.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// The gate and the usage build are the database's; their own specs are
// readershipDoor.test.ts and the dumps'.
const gate = vi.hoisted(() => ({ curatorGateOn: vi.fn() }));
const usage = vi.hoisted(() => ({ latestUsage: vi.fn(), usedByAGuide: vi.fn() }));
vi.mock('../readershipDoor.js', () => gate);
vi.mock('../../dumps/wikivoyage/usageTables.js', () => usage);

import { guideDoorOpen, readGuideDoor } from './guideDoor.js';

describe('readGuideDoor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gate.curatorGateOn.mockResolvedValue(true);
    usage.latestUsage.mockResolvedValue({ dumpDate: '2026-10-19', swappedAt: new Date(), needs: 'nothing' });
    usage.usedByAGuide.mockResolvedValue(new Set(['Q963472']));
  });

  it('reads the candidates a guide uses while the gate is on and a usage build is in place', async () => {
    expect(await readGuideDoor(6, ['Q963472', 'Q2'], '[test]')).toEqual(new Set(['Q963472']));
    expect(usage.usedByAGuide).toHaveBeenCalledWith(['Q963472', 'Q2']);
    expect(await guideDoorOpen(7, '[test]')).toBe(true);
  });

  it('is shut while the source\'s curator gate is off (ADR-0056 decision 5): every arrival through it is for a person', async () => {
    gate.curatorGateOn.mockResolvedValue(false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await readGuideDoor(6, ['Q963472'], '[test]')).toBeNull();
    expect(gate.curatorGateOn).toHaveBeenCalledWith(6);
    expect(usage.usedByAGuide).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join('\n')).toContain('curator gate is off');
    log.mockRestore();
  });

  it('is shut while no Wikivoyage usage build is in place', async () => {
    usage.latestUsage.mockResolvedValue(null);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await readGuideDoor(6, ['Q963472'], '[test]')).toBeNull();
    expect(await guideDoorOpen(7, '[test]')).toBe(false);
    expect(usage.usedByAGuide).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join('\n')).toContain('No Wikivoyage usage is built');
    log.mockRestore();
  });
});
