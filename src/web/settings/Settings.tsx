import { ArrowLeft } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { SettingsDto } from "../../shared/dto";
import { useSaveSettings } from "../shell/data";

export function Settings({
  settings,
  required,
  onBack,
  onSaved,
}: {
  settings: SettingsDto;
  required: boolean;
  onBack: () => void;
  onSaved: () => void;
}) {
  const save = useSaveSettings();
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
      <header className="flex items-start gap-3 border-b px-6 pt-4 pb-3 max-[759px]:px-4">
        {!required && (
          <button
            type="button"
            className="rl-m-only size-[30px] cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-hover"
            aria-label="Back to the list"
            onClick={onBack}
          >
            <ArrowLeft aria-hidden className="size-4" />
          </button>
        )}
        <h1 className="m-0 flex-1 text-[19px] leading-snug font-bold tracking-tight">Settings</h1>
      </header>
      <div className="flex-1 overflow-auto px-6 pt-[18px] pb-6 max-[759px]:px-4">
        <form className="grid max-w-[560px] gap-4" onSubmit={submit} key={settings.baseUrl ?? ""}>
          {settings.baseUrl === null && (
            <p className="m-0">Connect Review Loop to your Bitbucket Server. It checks your pull requests every minute.</p>
          )}
          {missing && <p className="m-0">The service restarted, and the token was in memory only. Enter the token again.</p>}
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="set-url">Bitbucket URL</FieldLabel>
              <Input
                id="set-url"
                name="baseUrl"
                type="url"
                required
                defaultValue={settings.baseUrl ?? ""}
                placeholder="https://bitbucket.example.com"
                autoComplete="url"
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
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={settings.tokenStored ? "Stored. Leave empty to keep it." : "Personal access token"}
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
                defaultValue={settings.caFile ?? ""}
                placeholder="C:\certs\company-ca.pem"
              />
              <FieldDescription>A PEM file for a server certificate from a private CA.</FieldDescription>
            </Field>
            {save.error && !(save.error instanceof TypeError) && <FieldError>{save.error.message}</FieldError>}
            {settings.user && (
              <p className="m-0 text-[12.5px] text-muted-foreground">
                Signed in as <span className="font-mono">{settings.user}</span>.
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
      </div>
    </>
  );
}
