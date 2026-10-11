import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { HELP_KEYS } from "../keys";

export function HelpSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        {HELP_KEYS.map((g) => (
          <section key={g.group} className="grid gap-2">
            <h3 className="m-0 text-sm font-semibold">{g.group}</h3>
            <dl className="m-0 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-2">
              {g.keys.map((k) => (
                <div key={k.text} className="contents">
                  <dt className="flex items-center gap-1">
                    {k.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                    {k.second && <span className="text-xs text-muted-foreground">then</span>}
                    {k.second?.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </dt>
                  <dd className="m-0 text-ink-2">{k.text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
