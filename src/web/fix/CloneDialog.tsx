// The folder of the user's clone (plan r3): one path per repository, kept in the app database. The server checks it on save.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type KeyboardEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { CloneDto } from "../../shared/dto";
import { cloneKey, dropClone, putClone } from "./data";

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
      qc.setQueryData(cloneKey(props.pr), c);
      props.onSaved(c);
    },
  });
  const clear = useMutation({
    mutationFn: () => dropClone(props.pr),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cloneKey(props.pr) });
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
