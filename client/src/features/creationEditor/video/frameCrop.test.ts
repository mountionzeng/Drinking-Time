import { describe, expect, it } from 'vitest';
import { quadrantRect } from './frameCrop';

describe('quadrantRect', () => {
  it('splits an even image into four equal quadrants', () => {
    expect(quadrantRect('top-left', 1000, 800)).toEqual({
      left: 0,
      top: 0,
      width: 500,
      height: 400,
    });
    expect(quadrantRect('bottom-right', 1000, 800)).toEqual({
      left: 500,
      top: 400,
      width: 500,
      height: 400,
    });
  });

  it('keeps the remainder pixels on right and bottom quadrants', () => {
    expect(quadrantRect('top-right', 1001, 801)).toEqual({
      left: 500,
      top: 0,
      width: 501,
      height: 400,
    });
    expect(quadrantRect('bottom-left', 1001, 801)).toEqual({
      left: 0,
      top: 400,
      width: 500,
      height: 401,
    });
  });
});
