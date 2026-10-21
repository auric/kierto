// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The Appropriate Legal Notices of AGPL-3.0 section 0 and the attribution term of NOTICE.md.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { dialogKeys } from "../fix/CloneDialog";
import { useMeta } from "../meta";

type Doc = "license" | "notices";

const TITLE: Record<Doc, string> = { license: "License", notices: "Third-party notices" };
const linkish = "rl-hit cursor-pointer rounded text-xs font-medium text-pen hover:underline";

// The texts load only when a dialog opens, so they stay out of the start-up chunks.
async function load(doc: Doc): Promise<string> {
  if (doc === "notices") return (await import("../../../THIRD_PARTY_NOTICES.md?raw")).default;
  const [notice, license] = await Promise.all([import("../../../NOTICE.md?raw"), import("../../../LICENSE?raw")]);
  return `${notice.default}\n\n${license.default}`;
}

export function About() {
  const app = useMeta().data?.app;
  const [doc, setDoc] = useState<Doc | null>(null);
  const [shown, setShown] = useState<Doc>("license");
  const text = useQuery({
    queryKey: ["legal", shown],
    queryFn: () => load(shown),
    enabled: doc !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const open = (d: Doc) => {
    setShown(d);
    setDoc(d);
  };
  return (
    <footer className="mt-10 grid max-w-[560px] gap-1 border-t pt-4 text-xs text-muted-foreground">
      <p className="m-0 text-sm font-semibold text-ink-2">PR Review Inbox by Ihor Lifanov</p>
      {app && (
        <p className="m-0">
          Version {app.version}
          {app.commit ? (
            <>
              , commit{" "}
              <span translate="no" className="font-mono">
                {app.commit}
              </span>
              .
            </>
          ) : (
            ", run from source."
          )}
        </p>
      )}
      <p className="m-0">
        Copyright (c) 2026 Ihor Lifanov. You can share and change PR Review Inbox under the GNU AGPL, version 3 or later. It comes with no
        warranty.
      </p>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {(["license", "notices"] as const).map((d) => (
          <button key={d} type="button" className={linkish} onClick={() => open(d)}>
            {TITLE[d]}
          </button>
        ))}
        <a className={linkish} href="https://github.com/auric/pr-review-inbox" target="_blank" rel="noopener noreferrer">
          Source code
        </a>
      </div>
      <Dialog open={doc !== null} onOpenChange={(o) => !o && setDoc(null)}>
        {/* The title row and the footer stay put. Only the text scrolls. */}
        <DialogContent
          className="max-h-[min(85vh,800px)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[760px]"
          onKeyDown={dialogKeys(() => setDoc(null))}
        >
          <DialogTitle>{TITLE[shown]}</DialogTitle>
          <div
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll region needs keyboard focus.
            tabIndex={0}
            className="min-h-0 overflow-auto rounded-md border bg-sunken p-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {text.data !== undefined ? (
              <pre className="m-0 font-mono text-xs break-words whitespace-pre-wrap select-text">{text.data}</pre>
            ) : (
              <p className="m-0 text-muted-foreground">{text.isError ? "Could not load the text. Reload the page." : "Loading…"}</p>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </footer>
  );
}
