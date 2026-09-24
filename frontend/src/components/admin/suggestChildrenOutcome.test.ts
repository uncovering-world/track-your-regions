import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { failedActionsError } from './suggestChildrenOutcome';

const REFUSAL = 'Travellers have recorded visits on a region this change would delete. '
  + 'A hierarchy edit does not delete a visit, so this edit was not made.';

describe('failedActionsError', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('says nothing when every action went through', () => {
    expect(failedActionsError([{ status: 'fulfilled', value: undefined }])).toBeNull();
  });

  it('carries the server\'s sentence for a refused remove, once, with the count (#764)', () => {
    const error = failedActionsError([
      { status: 'fulfilled', value: undefined },
      { status: 'rejected', reason: new Error(REFUSAL) },
      { status: 'rejected', reason: new Error(REFUSAL) },
    ]);

    expect(error?.message).toContain('2 of 3 action(s) failed.');
    expect(error?.message.split(REFUSAL)).toHaveLength(2);
  });
});
