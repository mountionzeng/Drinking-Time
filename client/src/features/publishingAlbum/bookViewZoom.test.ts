import { describe, expect, it, vi } from 'vitest';
import { bindBookViewZoom } from './bookViewZoom';

function setup() {
  const element = Object.assign(new EventTarget(), {
    clientHeight: 600,
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 900, height: 1200 }),
  });
  const change = vi.fn();
  const cancel = vi.fn();
  const dispose = bindBookViewZoom(element as unknown as HTMLElement, change, cancel);
  const send = (type: string, values: Record<string, unknown> = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), values);
    element.dispatchEvent(event);
    return event;
  };
  return { change, cancel, dispose, send };
}
const fingers = (distance: number) => [
  { clientX: 200 - distance / 2, clientY: 200 },
  { clientX: 200 + distance / 2, clientY: 200 },
];

describe('article view gestures', () => {
  it('leaves ordinary scrolling alone; trackpad pinch/Ctrl wheel magnifies only the article around the pointer', () => {
    const { send, change } = setup();
    expect(send('wheel', { deltaY: 100 }).defaultPrevented).toBe(false);
    expect(change).not.toHaveBeenCalled();
    expect(send('wheel', { ctrlKey: true, deltaY: -40, deltaMode: 0, clientX: 250, clientY: 300 }).defaultPrevented).toBe(true);
    expect(change).toHaveBeenLastCalledWith(Math.exp(0.2), { x: 250, y: 300 });
  });

  it('bounds repeated wheel zoom at half and double, and normalizes line scrolling', () => {
    const { send, change } = setup();
    send('wheel', { metaKey: true, deltaY: -1000, deltaMode: 1 });
    expect(change.mock.lastCall?.[0]).toBe(2);
    send('wheel', { ctrlKey: true, deltaY: -500 });
    expect(change).toHaveBeenCalledTimes(1);
    send('wheel', { ctrlKey: true, deltaY: 1000, deltaMode: 0 });
    expect(change.mock.lastCall?.[0]).toBe(0.5);
  });

  it('supports two-finger pinch without consuming one-finger scroll and cancels a module drag first', () => {
    const { send, change, cancel } = setup();
    expect(send('touchstart', { touches: fingers(100).slice(0, 1) }).defaultPrevented).toBe(false);
    expect(send('touchstart', { touches: fingers(100) }).defaultPrevented).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    send('touchmove', { touches: fingers(150) });
    expect(change).toHaveBeenLastCalledWith(1.5, { x: 200, y: 200 });
    send('touchcancel');
    send('touchmove', { touches: fingers(200) });
    expect(change).toHaveBeenCalledTimes(1);
    send('touchstart', { touches: fingers(150) });
    send('touchmove', { touches: fingers(100) });
    expect(change.mock.lastCall?.[0]).toBe(1);
  });

  it('supports Safari gestures and does not apply the duplicate touch/wheel path', () => {
    const { send, change } = setup();
    send('gesturestart');
    send('gesturechange', { scale: 1.4, clientX: 200, clientY: 200 });
    expect(change.mock.lastCall?.[0]).toBe(1.4);
    send('wheel', { ctrlKey: true, deltaY: -50 });
    expect(change).toHaveBeenCalledTimes(1);
    send('gestureend');
    send('touchstart', { touches: fingers(100) });
    send('gesturestart');
    send('touchmove', { touches: fingers(120) });
    send('gesturechange', { scale: 1.2, clientX: 200, clientY: 200 });
    expect(change).toHaveBeenCalledTimes(2);
    expect(change.mock.lastCall?.[0]).toBeCloseTo(1.68);
  });

  it('allows scoped keyboard zoom/reset and removes all handlers on unmount', () => {
    const { send, change, dispose } = setup();
    expect(send('keydown', { key: '+' }).defaultPrevented).toBe(false);
    send('keydown', { key: '=', ctrlKey: true });
    expect(change.mock.lastCall?.[0]).toBe(1.1);
    send('keydown', { key: '0', metaKey: true });
    expect(change.mock.lastCall?.[0]).toBe(1);
    dispose();
    expect(send('wheel', { ctrlKey: true, deltaY: -200 }).defaultPrevented).toBe(false);
    expect(send('touchstart', { touches: fingers(100) }).defaultPrevented).toBe(false);
    expect(change).toHaveBeenCalledTimes(2);
  });
});
