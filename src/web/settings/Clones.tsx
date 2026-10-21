// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The clone folders of Fix it (plan r3): one per repository. Change and Remove use the clone routes of a PR in that repository.
// The opt-in of "Ask your session" (docs/plans/session-consult.md part C) lives here too.
import { useQueryClient } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import type { CloneRowDto, SettingsDto } from "../../shared/dto";
import { CloneDialog, CloneFolder } from "../fix/CloneDialog";
import { clonesChanged, dropClone, useClones } from "../fix/data";
import { useMeta } from "../meta";
import { useSaveSettings } from "../shell/data";
import { failText } from "../shell/model";

const name = (c: Pick<CloneRowDto, "project" | "repo">) => `${c.project}/${c.repo}`;

// docs/plans/session-consult.md part C: the opt-in of "Ask your session". Off by default. While it is off, the app reads no
// transcript. A clone folder of the list above ranks the sessions in it first.
function SessionSwitch({ settings }: { settings: SettingsDto }) {
  const save = useSaveSettings();
  const runner = useMeta().data?.runner.short ?? "";
  return (
    <Field orientation="horizontal" className="border-t pt-3" data-sessions-switch>
      <Switch
        id="sessions-on"
        aria-describedby="sessions-on-help"
        checked={settings.sessions}
        disabled={save.isPending}
        onCheckedChange={(sessions) => save.mutate({ baseUrl: settings.baseUrl ?? "", caFile: settings.caFile ?? "", sessions })}
      />
      <FieldContent>
        <FieldLabel htmlFor="sessions-on">Let Kierto find and consult your {runner} sessions</FieldLabel>
        <FieldDescription id="sessions-on-help">
          Off by default. When on, “Ask your session” lists your transcripts on the branch of your own pull request. The app reads only
          their folder, branch, time, and title lines. It never shows or stores their message text. Each question resumes a copy of the
          session with its full history, so it uses your plan quota.
        </FieldDescription>
        {save.error && !(save.error instanceof TypeError) && <FieldError>{save.error.message}</FieldError>}
      </FieldContent>
    </Field>
  );
}

export function Clones({ settings }: { settings: SettingsDto }) {
  const qc = useQueryClient();
  const q = useClones();
  const [editing, setEditing] = useState<CloneRowDto | null>(null);
  // The last row stays while the dialog plays its close transition.
  const last = useRef<CloneRowDto | null>(null);
  if (editing) last.current = editing;
  const shown = last.current;
  const [said, setSaid] = useState({ text: "", n: 0 });
  const [busy, setBusy] = useState<string | null>(null);
  const say = (text: string) => setSaid((s) => ({ text, n: s.n + 1 }));
  // A removed row takes its buttons away, so the focus goes to the heading.
  const toHeading = () => requestAnimationFrame(() => document.getElementById("h-clones")?.focus());
  const remove = async (c: CloneRowDto) => {
    setBusy(name(c));
    try {
      await dropClone(c.pr);
      clonesChanged(qc);
      say(`Removed the clone folder of ${name(c)}. The folder stays on disk.`);
      toHeading();
    } catch (e) {
      toast.add({ title: "The clone folder was not removed", description: failText(e, "page") });
    } finally {
      setBusy(null);
    }
  };
  const list = q.data ?? [];
  return (
    <section aria-labelledby="h-clones" className="mt-6 grid max-w-[560px] gap-3 border-t pt-4">
      <div className="grid gap-0.5">
        <h2 id="h-clones" tabIndex={-1} className="m-0 scroll-mt-4 text-[15px] font-bold outline-none">
          Clones
        </h2>
        <p className="m-0 text-xs text-muted-foreground">Change saves from its dialog. Remove saves at once.</p>
      </div>
      <p className="m-0 text-sm text-ink-2">
        Fix it commits in these folders only when you click Apply. Set a folder in the Apply dialog of your own pull request.
      </p>
      {q.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : q.error ? (
        <p className="m-0 flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-[15px] shrink-0" />
          Cannot read the clone folders. {q.error.message}
        </p>
      ) : list.length ? (
        <ul className="m-0 grid list-none rounded-md border p-0">
          {list.map((c) => (
            <li key={name(c)} data-clone={name(c)} className="grid gap-1 border-b px-3 py-2 last:border-b-0">
              <span translate="no" className="font-mono text-sm font-semibold [overflow-wrap:anywhere]">
                {name(c)}
              </span>
              <code translate="no" className="font-mono text-xs text-ink-2 [overflow-wrap:anywhere]">
                {c.path}
              </code>
              {c.missing && (
                <p className="m-0 flex items-start gap-1.5 text-xs text-destructive">
                  <CircleAlert aria-hidden className="mt-px size-[13px] shrink-0" />
                  The clone folder does not exist. Change it or remove it.
                </p>
              )}
              <div className="-ml-2 flex flex-wrap items-center gap-1">
                {!c.missing && <CloneFolder pr={c.pr} path={c.path} of={name(c)} />}
                <Button variant="ghost" size="sm" className="text-ink-2" onClick={() => setEditing(c)}>
                  Change<span className="sr-only"> the clone folder of {name(c)}</span>
                </Button>
                <Button variant="ghost" size="sm" className="text-ink-2" disabled={busy === name(c)} onClick={() => void remove(c)}>
                  Remove<span className="sr-only"> the clone folder of {name(c)}</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-muted-foreground">No clone folder is set.</p>
      )}
      <SessionSwitch settings={settings} />
      <p role="status" className="sr-only">
        <span key={said.n}>{said.text}</span>
      </p>
      {shown && (
        <CloneDialog
          pr={shown.pr}
          repo={name(shown)}
          path={shown.path}
          open={editing !== null}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            say(saved ? `Saved the clone folder of ${name(shown)}.` : `Removed the clone folder of ${name(shown)}.`);
            if (!saved) toHeading();
          }}
        />
      )}
    </section>
  );
}
