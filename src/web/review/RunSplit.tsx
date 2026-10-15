// The split button of Fix all valid: the main part runs with the brief profile. The menu runs once with another profile.
// Plan pr-view-v4 P7 replaces it with a plain Fix button. Review and Draft replies are plain buttons (P3).
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProfileDto } from "../../shared/dto";
import { Hint } from "../shell/Hint";

// A disabled part stays focusable, so the tooltip and the screen reader can give the reason.
const dim = "aria-disabled:cursor-default aria-disabled:opacity-50";

// id: the main part. label: its accessible name. current: the brief profile, marked Default.
// menu: the name of the menu button. heading: the label of the profile list. more: menu items after the profiles.
// onRun: menu is true for a profile item. finalFocus: the element that takes the focus when the menu closes. Absent or true: the menu button.
export function RunSplit(props: {
  id: string;
  variant: "default" | "outline";
  label?: string;
  hint: string;
  keys?: string;
  describedBy?: string;
  disabled?: boolean;
  children: ReactNode;
  menu: string;
  heading: string;
  profiles: ProfileDto[];
  current: string;
  onRun: (profile?: string, menu?: boolean) => void;
  more?: ReactNode;
  finalFocus?: () => HTMLElement | boolean | null;
}) {
  const { variant, disabled } = props;
  return (
    <ButtonGroup>
      <Hint label={props.hint}>
        <Button
          id={props.id}
          size="sm"
          variant={variant}
          disabled={disabled}
          focusableWhenDisabled
          aria-label={props.label}
          aria-describedby={props.describedBy}
          aria-keyshortcuts={props.keys}
          className={dim}
          onClick={() => props.onRun()}
        >
          {props.children}
        </Button>
      </Hint>
      <DropdownMenu modal={false}>
        <Hint label={props.menu}>
          <DropdownMenuTrigger
            disabled={disabled}
            render={<Button id={`${props.id}-menu`} size="icon-sm" variant={variant} aria-label={props.menu} className="w-6" />}
          >
            <ChevronDown aria-hidden className="rl-chev-d" />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end" className="w-72" finalFocus={props.finalFocus}>
          <DropdownMenuGroup>
            <DropdownMenuLabel>{props.heading}</DropdownMenuLabel>
            {props.profiles.map((p) => (
              <DropdownMenuItem
                key={p.id}
                data-profile={p.id}
                className="items-start py-1.5"
                onClick={() => props.onRun(p.id === props.current ? undefined : p.id, true)}
              >
                <span className="grid min-w-0 flex-1">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.note}</span>
                </span>
                {p.id === props.current && <DropdownMenuShortcut className="tracking-normal">Default</DropdownMenuShortcut>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          {props.more}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
