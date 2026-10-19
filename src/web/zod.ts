// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// zod probes `new Function` when it builds an object schema. The page CSP blocks eval, so Chrome logs a violation.
// main.tsx imports this module first, before any module that builds a schema.
import { z } from "zod";

z.config({ jitless: true });
