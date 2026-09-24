import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { mockRemove } = vi.hoisted(() => ({ mockRemove: vi.fn() }));

vi.mock('../../api/admin/worldViewImport', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  removeRegionFromImport: mockRemove,
}));

import { useTreeMutations } from './useTreeMutations';

const REFUSAL = 'Travellers have recorded visits on a region this change would delete. '
  + 'A hierarchy edit does not delete a visit, so this edit was not made.';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const deps = {
  onPreview: () => {},
  mapPickerStateRef: { current: null },
  setMapPickerState: () => {},
  setRemoveDialogState: () => {},
};

describe('a tree edit the server refuses (#764)', () => {
  it('keeps the refusal for the import review to show, apart from the undo snackbar', async () => {
    mockRemove.mockRejectedValue(new Error(REFUSAL));
    const { result } = renderHook(() => useTreeMutations(31, deps), { wrapper });

    act(() => {
      result.current.removeMutation.mutate({ regionId: 1223, reparentChildren: false });
    });

    await waitFor(() => expect(result.current.treeEditError?.message).toBe(REFUSAL));
    expect(result.current.undoSnackbar).toBeNull();

    act(() => result.current.setTreeEditError(null));
    expect(result.current.treeEditError).toBeNull();
  });
});
