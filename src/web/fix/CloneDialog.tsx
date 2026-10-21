// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The folder of the user's clone (plan r3): one path per repository, kept in the app database. The server checks it on save.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, FolderOpen } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { copyText } from "@/lib/clipboard";
import type { CloneDto } from "../../shared/dto";
import { Hint } from "../shell/Hint";
import { failText } from "../shell/model";
import { cloneKey, clonesChanged, dropClone, openCloneFolder, putClone } from "./data";

// Open folder and Copy path for the clone of the repository of PR pr. The server opens only the stored path, never this one.
// icons: icon buttons with the path in the tooltip, for the fix bar. of: the repository, for unique button names in a list.
// The status sits inside the component, so a screen reader reads it also inside a modal dialog.
export function CloneFolder({ pr, path, icons, of }: { pr: number; path: string; icons?: boolean; of?: string }) {
  // A count, so a second copy within 1.5 s starts the time again.
  const [copied, setCopied] = useState(0);
  const [said, setSaid] = useState({ text: "", n: 0 });
  const copyRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!copied) return;
    const h = setTimeout(() => setCopied(0), 1500);
    return () => clearTimeout(h);
  }, [copied]);
  const say = (text: string) => setSaid((s) => ({ text, n: s.n + 1 }));
  const open = async () => {
    try {
      const r = await openCloneFolder(pr);
      if (!r) return say("Opened the clone folder.");
      toast.add({ title: r.error });
      say(r.error);
      copyRef.current?.focus();
    } catch (e) {
      toast.add({ title: "The folder did not open", description: failText(e, "page") });
    }
  };
  const copy = () =>
    copyText(path).then((ok) => {
      if (!ok) return toast.add({ title: "The clipboard is blocked here. Select the path and press Ctrl+C." });
      setCopied((n) => n + 1);
      say("Copied the clone path.");
    });
  const suffix = of && <span className="sr-only"> of {of}</span>;
  const CopyIcon = copied ? Check : Copy;
  const status = (
    <span role="status" className="sr-only">
      <span key={said.n}>{said.text}</span>
    </span>
  );
  if (icons)
    return (
      <span className="inline-flex items-center gap-0.5">
        <Hint label={`Open the clone folder: ${path}`}>
          <Button variant="ghost" size="icon-sm" className="text-ink-2" aria-label="Open the clone folder" onClick={() => void open()}>
            <FolderOpen aria-hidden />
          </Button>
        </Hint>
        <Hint label={copied ? "Copied" : `Copy the clone path: ${path}`}>
          <Button
            ref={copyRef}
            variant="ghost"
            size="icon-sm"
            className="text-ink-2"
            aria-label="Copy the clone path"
            onClick={() => void copy()}
          >
            <CopyIcon key={copied} aria-hidden className={copied ? "rl-pop" : undefined} />
          </Button>
        </Hint>
        {status}
      </span>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Button variant="ghost" size="sm" className="text-ink-2" onClick={() => void open()}>
        <FolderOpen aria-hidden data-icon="inline-start" />
        Open folder{suffix}
      </Button>
      <Button ref={copyRef} variant="ghost" size="sm" className="text-ink-2" onClick={() => void copy()}>
        <CopyIcon key={copied} aria-hidden data-icon="inline-start" className={copied ? "rl-pop" : undefined} />
        {copied ? "Copied" : "Copy path"}
        {suffix}
      </Button>
      {status}
    </span>
  );
}

// Keys in a dialog never reach the shell key handler, so no detail key acts behind the dialog. Esc closes only this dialog.
export const dialogKeys = (close: () => void) => (e: KeyboardEvent) => {
  e.stopPropagation();
  if (e.key !== "Escape") return;
  e.preventDefault();
  close();
};

// repo: "PROJECT/repo". onSaved: the clone state after a save, or null after a clear.
export function CloneDialog(props: {
  pr: number;
  repo: string;
  path: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: (c: CloneDto | null) => void;
}) {
  const close = props.onClose;
  return (
    <Dialog open={props.open} onOpenChange={(on) => !on && close()}>
      <DialogContent className="sm:max-w-[560px]" onKeyDown={dialogKeys(close)}>
        <CloneForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function CloneForm(props: { pr: number; repo: string; path: string | null; onClose: () => void; onSaved: (c: CloneDto | null) => void }) {
  const qc = useQueryClient();
  const [path, setPath] = useState(props.path ?? "");
  const save = useMutation({
    mutationFn: (p: string) => putClone(props.pr, p),
    onSuccess: (c) => {
      clonesChanged(qc, props.pr);
      qc.setQueryData(cloneKey(props.pr), c);
      props.onSaved(c);
    },
  });
  const clear = useMutation({
    mutationFn: () => dropClone(props.pr),
    onSuccess: () => {
      clonesChanged(qc);
      props.onSaved(null);
    },
  });
  const busy = save.isPending || clear.isPending;
  const error = (save.error ?? clear.error)?.message ?? null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = path.trim();
    if (p && !busy) save.mutate(p);
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>Your clone of {props.repo}</DialogTitle>
        <DialogDescription>
          The top folder of your own git clone. The app applies and commits fixes there only when you click Apply, runs no network command
          there, and never pushes.
        </DialogDescription>
      </DialogHeader>
      <form id="clone-form" onSubmit={submit}>
        <FieldGroup>
          <Field data-invalid={!!error || undefined}>
            <FieldLabel htmlFor="clone-path">Clone folder</FieldLabel>
            <Input
              id="clone-path"
              className="font-mono"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="C:\work\repo"
              aria-invalid={!!error || undefined}
              required
            />
            <FieldDescription>One folder per repository. It must be on the source branch of the pull request to apply.</FieldDescription>
            {error && <FieldError>{error}</FieldError>}
          </Field>
        </FieldGroup>
      </form>
      <DialogFooter>
        {props.path && (
          <Button variant="ghost" className="mr-auto text-ink-2" disabled={busy} onClick={() => clear.mutate()}>
            Clear the folder
          </Button>
        )}
        <Button variant="outline" onClick={props.onClose}>
          Cancel
        </Button>
        <Button type="submit" form="clone-form" disabled={busy || !path.trim()}>
          {save.isPending ? "Checking…" : "Save folder"}
        </Button>
      </DialogFooter>
    </>
  );
}
