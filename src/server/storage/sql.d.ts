// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Import a .sql file only with { type: "text" }.
declare module "*.sql" {
  const text: string;
  export default text;
}
