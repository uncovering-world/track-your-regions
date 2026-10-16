import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubdivisionGroup } from './types';

const api = vi.hoisted(() => ({ saveRegionSubdivisionGroups: vi.fn() }));
vi.mock('../../../../../api/regions', () => api);

const { useSubdivisionGroupsSync } = await import('./useSubdivisionGroupsSync');

const FLANDERS: SubdivisionGroup = { name: 'Flanders', members: [] };
const WALLONIA: SubdivisionGroup = { name: 'Wallonia', members: [] };

beforeEach(() => {
  vi.useFakeTimers();
  api.saveRegionSubdivisionGroups.mockReset();
  api.saveRegionSubdivisionGroups.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('useSubdivisionGroupsSync (#595)', () => {
  it('saves nothing before the groups are read, so a failed load never overwrites them', async () => {
    const { rerender } = renderHook(({ groups }) => useSubdivisionGroupsSync(9321, true, groups), { initialProps: { groups: [FLANDERS] } });
    rerender({ groups: [FLANDERS, WALLONIA] });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(api.saveRegionSubdivisionGroups).not.toHaveBeenCalled();
  });

  it('saves a change a second after it, and not the groups it read', async () => {
    const { result, rerender } = renderHook(({ groups }) => useSubdivisionGroupsSync(9321, true, groups), { initialProps: { groups: [FLANDERS] } });
    act(() => result.current.settle([FLANDERS]));
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(api.saveRegionSubdivisionGroups).not.toHaveBeenCalled();

    rerender({ groups: [FLANDERS, WALLONIA] });
    await act(async () => { vi.advanceTimersByTime(999); });
    expect(api.saveRegionSubdivisionGroups).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(api.saveRegionSubdivisionGroups).toHaveBeenCalledWith(9321, { groups: [
      { name: 'Flanders', color: null, existingRegionId: null, memberRowIds: [] },
      { name: 'Wallonia', color: null, existingRegionId: null, memberRowIds: [] },
    ] });
  });

  it("saves an earlier session's groups it adopted, and says when a save fails", async () => {
    api.saveRegionSubdivisionGroups.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useSubdivisionGroupsSync(9321, true, [FLANDERS]));
    act(() => result.current.settle([FLANDERS], { save: true }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(api.saveRegionSubdivisionGroups).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatch(/not saved/);
  });

  it('sends one save at a time, the next with the groups as they are then', async () => {
    let finish: () => void = () => {};
    api.saveRegionSubdivisionGroups.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const NORTH: SubdivisionGroup = { name: 'North', members: [] };
    const { result, rerender } = renderHook(({ groups }) => useSubdivisionGroupsSync(9321, true, groups), { initialProps: { groups: [FLANDERS] } });
    act(() => result.current.settle([FLANDERS]));
    rerender({ groups: [FLANDERS, WALLONIA] });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(api.saveRegionSubdivisionGroups).toHaveBeenCalledTimes(1);

    // Two more edits while the first save is in flight: no second request yet.
    rerender({ groups: [FLANDERS, WALLONIA, NORTH] });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(api.saveRegionSubdivisionGroups).toHaveBeenCalledTimes(1);

    await act(async () => { finish(); });
    expect(api.saveRegionSubdivisionGroups).toHaveBeenCalledTimes(2);
    expect(api.saveRegionSubdivisionGroups.mock.calls[1][1].groups.map((g: { name: string }) => g.name)).toEqual(['Flanders', 'Wallonia', 'North']);
  });

  it('runs the adoption callback only once the save has landed', async () => {
    const onSaved = vi.fn();
    api.saveRegionSubdivisionGroups.mockRejectedValueOnce(new Error('offline'));
    const { result, rerender } = renderHook(({ groups }) => useSubdivisionGroupsSync(9321, true, groups), { initialProps: { groups: [FLANDERS] } });
    act(() => result.current.settle([FLANDERS], { save: true, onSaved }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(onSaved).not.toHaveBeenCalled();

    rerender({ groups: [FLANDERS, WALLONIA] });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('stops: waits for a save in flight, and sends nothing after', async () => {
    let finish: () => void = () => {};
    api.saveRegionSubdivisionGroups.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { result, rerender } = renderHook(({ groups }) => useSubdivisionGroupsSync(9321, true, groups), { initialProps: { groups: [FLANDERS] } });
    act(() => result.current.settle([FLANDERS]));
    rerender({ groups: [FLANDERS, WALLONIA] });
    await act(async () => { vi.advanceTimersByTime(1000); });

    let stopped = false;
    let stopping: Promise<void> = Promise.resolve();
    act(() => { stopping = result.current.stop().then(() => { stopped = true; }); });
    rerender({ groups: [WALLONIA] });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(stopped).toBe(false);
    await act(async () => { finish(); await stopping; });
    expect(stopped).toBe(true);
    expect(api.saveRegionSubdivisionGroups).toHaveBeenCalledTimes(1);
  });

  it("ignores a save of the region it left, and sends the next region's after it", async () => {
    let finish: () => void = () => {};
    let finishB: () => void = () => {};
    api.saveRegionSubdivisionGroups
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishB = resolve; }));
    const onSavedB = vi.fn();
    const { result, rerender } = renderHook(({ region, groups }) => useSubdivisionGroupsSync(region, true, groups), {
      initialProps: { region: 9321, groups: [FLANDERS] },
    });
    act(() => result.current.settle([FLANDERS]));
    rerender({ region: 9321, groups: [FLANDERS, WALLONIA] });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(api.saveRegionSubdivisionGroups).toHaveBeenLastCalledWith(9321, expect.anything());

    // The dialog moves to region 9322, whose adopted groups still have to be saved.
    rerender({ region: 9322, groups: [WALLONIA] });
    act(() => result.current.settle([WALLONIA], { save: true, onSaved: onSavedB }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(onSavedB).not.toHaveBeenCalled();

    // The earlier region's save lands: it says nothing of 9322, whose own save goes out now.
    await act(async () => { finish(); });
    expect(onSavedB).not.toHaveBeenCalled();
    expect(api.saveRegionSubdivisionGroups).toHaveBeenLastCalledWith(9322, { groups: [
      { name: 'Wallonia', color: null, existingRegionId: null, memberRowIds: [] },
    ] });
    await act(async () => { finishB(); });
    expect(onSavedB).toHaveBeenCalledTimes(1);
  });

  it('says nothing in the next region about a failed save of the one it left', async () => {
    let fail: (e: Error) => void = () => {};
    api.saveRegionSubdivisionGroups.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
    const { result, rerender } = renderHook(({ region, groups }) => useSubdivisionGroupsSync(region, true, groups), {
      initialProps: { region: 9321, groups: [FLANDERS] },
    });
    act(() => result.current.settle([FLANDERS]));
    rerender({ region: 9321, groups: [FLANDERS, WALLONIA] });
    await act(async () => { vi.advanceTimersByTime(1000); });
    rerender({ region: 9322, groups: [WALLONIA] });
    act(() => result.current.settle([WALLONIA]));
    await act(async () => { fail(new Error('offline')); });
    expect(result.current.error).toBeNull();
  });
});
