// SPDX-License-Identifier: MIT
//
// Minimal DOM stub for testing browser libs without pulling jsdom into
// devDependencies. Just enough to satisfy what the libs under test
// actually call: querySelectorAll, dataset, textContent, title,
// setAttribute, addEventListener / removeEventListener.

function fakeElement(initial = {}) {
  const attrs = new Map();
  return {
    textContent: '',
    title: '',
    dataset: { ...(initial.dataset || {}) },
    setAttribute(name, value) {
      attrs.set(name, value);
    },
    getAttribute(name) {
      return attrs.get(name);
    },
    _attrs: attrs,
    ...initial,
  };
}

// rules maps selector → array of fake elements.
// Example: fakeDocument({ '[data-i18n]': [el1, el2], '[data-i18n-title]': [el3] }).
function fakeDocument(rules = {}) {
  const listeners = new Map();
  return {
    querySelectorAll(selector) {
      return rules[selector] || [];
    },
    documentElement: { lang: '' },
    addEventListener(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
    },
    removeEventListener(event, fn) {
      if (listeners.has(event)) listeners.get(event).delete(fn);
    },
    _listeners: listeners,
    hidden: false,
  };
}

module.exports = { fakeElement, fakeDocument };
