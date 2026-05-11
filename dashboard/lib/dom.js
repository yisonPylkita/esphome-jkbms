// SPDX-License-Identifier: MIT
//
// Trivial DOM helpers shared across the dashboards. `$` for getElementById,
// `$$` for querySelectorAll → real array.

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

if (typeof module !== 'undefined') module.exports = { $, $$ };
