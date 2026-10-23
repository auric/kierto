// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// The Spec tab (docs/plans/review-v2/spec.md section 6.12): the plan files rendered as Markdown. Before the approval, "Edit" switches a
// file to a text area and "Save" stores it. A tasks grammar error keeps the old text and names the line (spec.md section 6.14).
import { Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { TaskDto } from "../../shared/dto";
import { TASK_DOCS, type TaskDoc } from "../../shared/task";
import { Text } from "../pr/Thread";

const NAME: Record<TaskDoc, string> = { plan: "plan.md", design: "design.md", spec: "spec.md", tasks: "tasks.md" };

export const docList = (t: Pick<TaskDto, "docs">) => TASK_DOCS.filter((d) => typeof t.docs?.[d] === "string");

export function SpecDocs(props: {
  t: TaskDto;
  // The file in edit mode, or null.
  editing: TaskDoc | null;
  editable: boolean;
  busy: boolean;
  error: string | null;
  onEdit: (doc: TaskDoc | null) => void;
  onSave: (doc: TaskDoc, text: string) => void;
}) {
  const { t, editing } = props;
  const docs = docList(t);
  const [draft, setDraft] = useState<{ doc: TaskDoc; text: string } | null>(null);
  if (!docs.length) return <p className="m-0 text-sm text-muted-foreground">The plan files show here when the plan is ready.</p>;
  const dir = t.specDir.replace(/\/+$/, "");
  return (
    <div className="grid gap-5">
      {docs.map((d) => {
        const text = t.docs?.[d] as string;
        const on = editing === d;
        const value = draft?.doc === d ? draft.text : text;
        return (
          <section key={d} aria-labelledby={`doc-${d}`} className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`doc-${d}`} translate="no" className="m-0 font-mono text-sm font-semibold">
                {dir}/{NAME[d]}
              </h3>
              {props.editable && !on && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="ml-auto"
                  aria-label={`Edit ${NAME[d]}`}
                  onClick={() => {
                    setDraft({ doc: d, text });
                    props.onEdit(d);
                  }}
                >
                  <Pencil aria-hidden data-icon="inline-start" />
                  Edit
                </Button>
              )}
            </div>
            {on ? (
              <form
                className="grid gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  props.onSave(d, value);
                }}
              >
                <Textarea
                  id={`doc-edit-${d}`}
                  aria-label={`Text of ${NAME[d]}`}
                  rows={18}
                  spellCheck={false}
                  className="font-mono text-xs"
                  value={value}
                  onChange={(e) => setDraft({ doc: d, text: e.target.value })}
                />
                {props.error && (
                  <p role="alert" className="m-0 text-sm text-destructive">
                    {props.error}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={props.busy}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setDraft(null);
                      props.onEdit(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <div className="rl-read max-w-[86ch] rounded-md border bg-card px-4 py-3 [overflow-wrap:anywhere]">
                <Text text={text} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
