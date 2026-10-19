// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../../src/web/pr/Markdown";

test("Markdown drops raw HTML, turns images into links, and opens links in a new tab", () => {
  const html = renderToStaticMarkup(
    <Markdown
      text={
        '<img src="https://x.test/a.png" onerror="alert(1)"> **b** [l](https://x.test/p) ![pic](https://x.test/i.png) [j](javascript:alert(1))'
      }
    />,
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain("onerror");
  expect(html).toContain("<strong>b</strong>");
  expect(html).toContain('<a href="https://x.test/p" target="_blank" rel="noopener noreferrer">l</a>');
  expect(html).toContain('<a href="https://x.test/i.png" target="_blank" rel="noopener noreferrer">pic</a>');
  expect(html).not.toContain("javascript:");
});
