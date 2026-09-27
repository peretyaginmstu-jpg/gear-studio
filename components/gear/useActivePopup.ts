"use client";
import { useState } from 'react';

/** Portals outlive hidden ancestors. Close their local state when the owning step leaves. */
export function useActivePopup(active: boolean) {
  const [open, setOpen] = useState(false);
  // A guarded render adjustment prevents reopening an old popup when the draft returns.
  if (!active && open) setOpen(false);
  return { open: active && open, onOpenChange: setOpen };
}
