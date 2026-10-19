// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 Ihor Lifanov

// Tooltips for icons without visible words. The trigger carries an aria-label with the same words.
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Side = "top" | "right" | "bottom" | "left";

// disabled: the words are visible, so the tooltip would repeat them.
export function Hint({ label, children, disabled, side }: { label: string; children: ReactElement; disabled?: boolean; side?: Side }) {
  return (
    <Tooltip disabled={disabled}>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

// One tooltip for many triggers, such as the hints in the list rows. Each trigger passes its words as the payload.
export type Hints = TooltipPrimitive.Handle<string>;
export const createHints = (): Hints => TooltipPrimitive.createHandle<string>();

export function SharedHint({ hints }: { hints: Hints }) {
  return <TooltipPrimitive.Root handle={hints}>{({ payload }) => <TooltipContent>{payload}</TooltipContent>}</TooltipPrimitive.Root>;
}

export function HintTrigger({ hints, label, children }: { hints: Hints; label: string; children: ReactElement }) {
  return <TooltipPrimitive.Trigger handle={hints} payload={label} render={children} />;
}
