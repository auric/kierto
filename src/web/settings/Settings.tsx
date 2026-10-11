import { ArrowLeft, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { PrRow, SettingsDto } from "../../shared/dto";
import { useForge } from "../meta";
import { notifyPermission } from "../notify";
import { useSaveSettings } from "../shell/data";
import { Hint } from "../shell/Hint";
import { TaskRules } from "./TaskRules";

const sectionTitle = "m-0 text-[15px] font-bold";

export function Settings({
  settings,
  required,
  prs,
  selected,
  onBack,
  onSaved,
}: {
  settings: SettingsDto;
  required: boolean;
  // The task-rule preview runs on one of these.
  prs: PrRow[];
  selected: number | null;
  onBack: () => void;
  onSaved: () => void;
}) {
  const save = useSaveSettings();
  const forge = useForge();
  // The token lives only in this field until submit. It is never read back from the server.
  const [token, setToken] = useState("");
  const memory = settings.tokenStorage === "memory";
  const missing = settings.baseUrl !== null && !settings.tokenStored;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate(
      { baseUrl: String(f.get("baseUrl") ?? ""), token, caFile: String(f.get("caFile") ?? "") },
      {
        onSuccess: () => {
          setToken("");
          onSaved();
        },
      },
    );
  }

  return (
    <>
      <header className="grid gap-1.5 border-b px-6 pt-3 pb-3.5 max-[759px]:px-4">
        <div className="flex min-h-7 items-center gap-2">
          {!required && (
            <button
              type="button"
              className="rl-m-only -ml-1.5 h-7 cursor-pointer items-center gap-1 rounded-md pr-2 pl-1 text-sm font-medium text-ink-2 hover:bg-hover"
              onClick={onBack}
            >
              <ArrowLeft aria-hidden className="size-[15px]" />
              Back to the list
            </button>
          )}
          {!required && (
            <Hint label="Close. Key: Esc">
              <button
                type="button"
                className="ml-auto inline-grid size-[30px] cursor-pointer place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-foreground"
                aria-label="Close the settings"
                onClick={onBack}
              >
                <X aria-hidden className="size-[15px]" />
              </button>
            </Hint>
          )}
        </div>
        <h1 className="m-0 text-(length:--fs-title) leading-tight font-bold tracking-[-0.015em]">Settings</h1>
      </header>
      <div className="@container relative flex-1 overflow-auto px-6 pt-[18px] pb-16 max-[759px]:px-4">
        <section aria-labelledby="h-connection" className="grid max-w-[560px] gap-3">
          <h2 id="h-connection" className={sectionTitle}>
            Connection
          </h2>
          <form className="grid gap-4" onSubmit={submit} key={settings.baseUrl ?? ""}>
            {settings.baseUrl === null && (
              <p className="m-0">Connect Review Loop to your {forge} server. It checks your pull requests every minute.</p>
            )}
            {missing && <p className="m-0">The service restarted, and the token was in memory only. Enter the token again.</p>}
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="set-url">{forge} URL</FieldLabel>
                <Input
                  id="set-url"
                  name="baseUrl"
                  type="url"
                  required
                  defaultValue={settings.baseUrl ?? ""}
                  placeholder="https://forge.example.com"
                  autoComplete="url"
                  spellCheck={false}
                />
                <FieldDescription>The base URL only. Include the context path if your server has one.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="set-token">Access token</FieldLabel>
                <Input
                  id="set-token"
                  name="token"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={settings.tokenStored ? "Stored. Leave empty to keep it." : "Personal access token…"}
                />
                <FieldDescription>
                  {memory
                    ? "Token kept in memory only. Enter it again after a restart."
                    : "Token kept in the system credential store on this machine."}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="set-ca">CA file (optional)</FieldLabel>
                <Input
                  id="set-ca"
                  name="caFile"
                  type="text"
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  defaultValue={settings.caFile ?? ""}
                  placeholder="C:\certs\company-ca.pem"
                />
                <FieldDescription>A PEM file for a server certificate from a private CA.</FieldDescription>
              </Field>
              {save.error && !(save.error instanceof TypeError) && <FieldError>{save.error.message}</FieldError>}
              {settings.user && (
                <p className="m-0 text-sm text-muted-foreground">
                  Signed in as{" "}
                  <span translate="no" className="font-mono">
                    {settings.user}
                  </span>
                  .
                </p>
              )}
            </FieldGroup>
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Checking…" : "Save"}
              </Button>
              {!required && (
                <Button type="button" variant="outline" onClick={onBack}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </section>
        {settings.baseUrl !== null && <Notifications settings={settings} />}
        {settings.baseUrl !== null && <TaskRules settings={settings} prs={prs} selected={selected} />}
      </div>
    </>
  );
}

const PERMISSION_NOTE: Partial<Record<ReturnType<typeof notifyPermission>, string>> = {
  denied: "This browser blocks notifications for Review Loop. Allow them in the site settings. The inbox badges still show new activity.",
  unsupported: "This browser does not support notifications. The inbox badges still show new activity.",
};

function Notifications({ settings }: { settings: SettingsDto }) {
  const save = useSaveSettings();
  const [permission, setPermission] = useState(notifyPermission);
  const on = settings.notifications && permission === "granted";

  async function toggle() {
    let next = !on;
    if (next && permission !== "granted") {
      const p = permission === "default" ? await Notification.requestPermission() : permission;
      setPermission(p);
      next = p === "granted";
    }
    // Only the notifications flag changes, so the server saves without a forge request.
    if (next !== settings.notifications)
      save.mutate({ baseUrl: settings.baseUrl ?? "", caFile: settings.caFile ?? "", notifications: next });
  }

  const note = PERMISSION_NOTE[permission];
  return (
    <section aria-labelledby="notify-title" className="mt-6 grid max-w-[560px] gap-2 border-t pt-4">
      <h2 id="notify-title" className={sectionTitle}>
        Notifications
      </h2>
      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={on}
          disabled={save.isPending || permission === "unsupported"}
          onChange={() => void toggle()}
        />
        Show a desktop notification for new activity
      </label>
      <p className="m-0 text-sm text-muted-foreground">One notification per pull request. Several open tabs never repeat it.</p>
      {note && <p className="m-0 text-sm text-ink-2">{note}</p>}
      {save.error && !(save.error instanceof TypeError) && <FieldError>{save.error.message}</FieldError>}
    </section>
  );
}
