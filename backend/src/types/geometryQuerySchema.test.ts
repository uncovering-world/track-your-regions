import { describe, expect, it } from 'vitest';
import { getGeometryQuerySchema } from './index.js';

describe('the division geometry read\'s query', () => {
  it('asks for the full shape when it names no detail, which the cutting tools rely on (#1010)', () => {
    expect(getGeometryQuerySchema.parse({})).toEqual({ detail: 'high' });
  });

  it('keeps the detail a preview asks for', () => {
    expect(getGeometryQuerySchema.parse({ detail: 'low' })).toEqual({ detail: 'low' });
  });

  it('accepts no parameter the handler does not read', () => {
    // worldViewId and resolveEmpty were validated and discarded; stripped now,
    // so a caller cannot think either one did anything.
    expect(getGeometryQuerySchema.parse({ detail: 'medium', worldViewId: '5', resolveEmpty: 'true' }))
      .toEqual({ detail: 'medium' });
  });
});
