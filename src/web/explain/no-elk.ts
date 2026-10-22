// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// vite.config.ts puts this module in place of elkjs: its EPL-2.0 license is not GPL-compatible. mermaid.ts never asks for the ELK layout.
export default class ELK {
  constructor() {
    throw new Error("The ELK layout is not available.");
  }
}
