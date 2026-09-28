"use client";
import { useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface TrayTool {
  id: string; icon: ReactNode; label: string; title: string; description?: string;
  /** Short state shown on the chip when the tool is in use, e.g. «паз 4×1,8». */
  badge?: string | null; hidden?: boolean;
  render: (close: () => void) => ReactNode;
}

/** Optional tools as quiet chips; each opens only when asked, in its own pop-up. */
export function ToolTray({ tools, label, className = '' }: { tools: TrayTool[]; label: string; className?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const visible = tools.filter(t => !t.hidden), current = visible.find(t => t.id === open) ?? null;
  if (!visible.length) return null;
  return <div className={`tool-tray ${className}`}>
    <span className="tool-tray-label">{label}</span>
    <div className="tool-tray-chips">{visible.map(t => <button key={t.id} type="button" className={`tool-chip${t.badge ? ' active' : ''}`} onClick={() => setOpen(t.id)} aria-haspopup="dialog">
      {t.icon}<span>{t.label}</span>{t.badge && <b>{t.badge}</b>}</button>)}</div>
    <Dialog open={!!current} onOpenChange={value => { if (!value) setOpen(null); }}>
      {current && <DialogContent className="engineering-dialog tool-dialog">
        <DialogHeader><DialogTitle>{current.title}</DialogTitle>{current.description && <DialogDescription>{current.description}</DialogDescription>}</DialogHeader>
        {current.render(() => setOpen(null))}
      </DialogContent>}
    </Dialog>
  </div>;
}
