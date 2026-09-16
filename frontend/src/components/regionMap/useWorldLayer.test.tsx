import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AppAddress } from '../../utils/appUrl';

const { mockFetchKinds, navState, addressState, mockGo } = vi.hoisted(() => ({
  mockFetchKinds: vi.fn(),
  navState: {
    selectedRegion: null as { id: number } | null,
    isCustomWorldView: true,
  },
  addressState: {
    address: null as AppAddress | null,
  },
  mockGo: vi.fn(),
}));

vi.mock('../../api/experiences', () => ({
  fetchExperienceKinds: mockFetchKinds,
}));

vi.mock('../../hooks/useNavigation', () => ({
  useNavigation: () => navState,
}));

vi.mock('../../hooks/useAppAddress', () => ({
  useAppAddress: () => ({ address: addressState.address, go: mockGo }),
}));

import { useWorldLayer } from './useWorldLayer';

const MAP_ROOT: AppAddress = {
  mode: 'map', worldViewId: 5, regionId: null, experienceId: null, kindId: null,
};

const KINDS = [
  { id: 1, name: 'World Heritage Sites', display_priority: 1, experience_count: '1272' },
  { id: 5, name: 'Archaeology', display_priority: 5, experience_count: '1010' },
];

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/**
 * Whether the map draws the catalogue instead of a region, which kind it draws,
 * and whether it is folded (#910).
 */
describe('useWorldLayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navState.selectedRegion = null;
    navState.isCustomWorldView = true;
    addressState.address = MAP_ROOT;
    mockFetchKinds.mockResolvedValue(KINDS);
  });

  const render = () => renderHook(() => useWorldLayer(), { wrapper: makeWrapper() });

  it('draws while a custom world view has nothing selected', () => {
    expect(render().result.current.active).toBe(true);
  });

  it('gives the map back to a region the moment one is chosen', () => {
    // The region's own markers and its own list answer for it from then on,
    // which is what "selecting a region keeps behaving as today" means.
    navState.selectedRegion = { id: 6737 };
    expect(render().result.current.active).toBe(false);
  });

  it('draws in no world view whose regions could not open a pin', () => {
    // The default world view owns no regions — its map is the administrative
    // tree — so `openableRegion` would answer null for every pin on it and the
    // click could only be dead (ADR-0042 refuses another world view's address).
    navState.isCustomWorldView = false;
    expect(render().result.current.active).toBe(false);
  });

  it('asks for the kinds only where the layer draws', async () => {
    // The control is the only thing that needs them here, and these reads sit
    // under `publicReadLimiter` beside the ones that draw a region's list.
    navState.selectedRegion = { id: 6737 };
    render();
    await waitFor(() => expect(mockFetchKinds).not.toHaveBeenCalled());
  });

  it('takes the kind from the address', async () => {
    addressState.address = { ...MAP_ROOT, kindId: 5 };
    const { result } = render();
    await waitFor(() => expect(result.current.kinds).toHaveLength(2));
    expect(result.current.kindId).toBe(5);
    expect(result.current.kindNameOf(5)).toBe('Archaeology');
  });

  it('writes the kind into the address, relative to whatever it now names', async () => {
    const { result } = render();
    act(() => result.current.setKind(1));

    expect(mockGo).toHaveBeenCalledTimes(1);
    const [target] = mockGo.mock.calls[0];
    // A function, not an object: a chip clicked twice before React has
    // re-rendered must build the second write on the first, not on the address
    // of the render before either (`useAppAddress`, § GoTarget).
    expect(typeof target).toBe('function');
    expect(target({ ...MAP_ROOT, kindId: 5 })).toEqual({ ...MAP_ROOT, kindId: 1 });
  });

  it('drops a kind nobody knows, in place, once the kinds have answered', async () => {
    addressState.address = { ...MAP_ROOT, kindId: 999 };
    const { result } = render();

    await waitFor(() => expect(mockGo).toHaveBeenCalled());
    // Read as absent straight away — the map draws every kind rather than none.
    expect(result.current.kindId).toBeNull();
    const [target, options] = mockGo.mock.calls[0];
    expect(target({ ...MAP_ROOT, kindId: 999 })).toEqual(MAP_ROOT);
    // Replaced: the visitor never asked for this, so it is not a step in their
    // history — the rule every other degradation in `docs/tech/addresses.md`
    // follows.
    expect(options).toEqual({ replace: true });
  });

  it('draws the address\u2019s kind while the kinds are still in flight', () => {
    // Not "unknown until proven known": the empty list is not an answer, and
    // reading it as one would mount the all-kinds tiles for a shared link to
    // one kind and then throw them away.
    addressState.address = { ...MAP_ROOT, kindId: 5 };
    mockFetchKinds.mockReturnValue(new Promise(() => {}));
    expect(render().result.current.kindId).toBe(5);
  });

  it('waits for a real answer before dropping anything', () => {
    // The empty list that stands in while the read is in flight is not an
    // answer about which kinds exist, and treating it as one would spend a
    // shared link on a hiccup — and not give it back.
    addressState.address = { ...MAP_ROOT, kindId: 999 };
    mockFetchKinds.mockReturnValue(new Promise(() => {}));
    render();
    expect(mockGo).not.toHaveBeenCalled();
  });

  it('starts unfolded — every place — and toggles', () => {
    const { result } = render();
    expect(result.current.folded).toBe(false);
    act(() => result.current.toggleFold());
    expect(result.current.folded).toBe(true);
    // And stays out of the address: it is a way of looking at what is on the
    // screen, not a place, and Back through it would be a step nobody took.
    expect(mockGo).not.toHaveBeenCalled();
  });
});
