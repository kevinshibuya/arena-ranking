import { lookupReserve } from './riot-rate-limit';

describe('the lookup reserve', () => {
  it.each([
    [20, 2],
    [100, 10],
    [10, 1],
    [3, 1],
    [2, 1],
    [1, 0],
  ])('keeps a tenth of a window of %i, at least one slot, never the whole window: %i', (max, reserve) => {
    expect(lookupReserve(max)).toBe(reserve);
  });
});
