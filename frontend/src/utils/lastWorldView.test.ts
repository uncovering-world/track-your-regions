import { afterEach, describe, expect, it } from 'vitest';
import { lastWorldView, rememberWorldView } from './lastWorldView';

afterEach(() => rememberWorldView(null));

describe('the world view a reader last had open (#2474)', () => {
  it('reads back the custom world view remembered, and none once the default is open', () => {
    rememberWorldView(9);
    expect(lastWorldView()).toBe(9);
    rememberWorldView(null);
    expect(lastWorldView()).toBeNull();
  });

  it('reads nothing it cannot take for a world view id', () => {
    sessionStorage.setItem('tyr.lastWorldViewId', 'not a number');
    expect(lastWorldView()).toBeNull();
  });
});
