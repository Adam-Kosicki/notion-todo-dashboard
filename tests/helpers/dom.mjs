// Minimal global-jsdom installer for node:test component-interaction tests. React and
// @testing-library/react check for `window`/`document` on the real Node global object (not an
// isolated sandbox), so this assigns jsdom's window properties onto globalThis rather than
// passing a window into a VM context - the same approach the `global-jsdom` package uses, hand-
// rolled here to avoid adding a dependency for ~15 lines of setup.
import { JSDOM } from "jsdom";

export function installDom(url = "http://localhost/") {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url, pretendToBeVisual: true });
  const { window } = dom;

  const keys = [
    "window", "document", "navigator", "HTMLElement", "Element", "Node", "Event",
    "MouseEvent", "KeyboardEvent", "customElements", "getComputedStyle", "requestAnimationFrame",
    "cancelAnimationFrame", "DocumentFragment", "SVGElement",
  ];
  // Some of these (e.g. `navigator` since Node 21) are already globals defined with only a
  // getter, so a plain `globalThis[key] = ...` throws - defineProperty overrides them instead.
  const previous = {};
  for (const key of keys) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    if (key in window) {
      Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
    }
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  return function uninstallDom() {
    for (const key of keys) {
      if (previous[key] === undefined) delete globalThis[key];
      else Object.defineProperty(globalThis, key, previous[key]);
    }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    window.close();
  };
}
