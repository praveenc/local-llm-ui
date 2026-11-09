import '@testing-library/jest-dom/vitest';

// jsdom has no ResizeObserver; Radix UI (Slider, Popover) needs it
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom has no scrollIntoView; Radix Select calls it when it opens. Server tests run in the
// node environment, which has no DOM.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
