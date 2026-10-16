import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

type CollapsibleProps = {
  title: string;
  summary: string;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ComponentChildren;
};

// A card that shows its title and a one-line summary, and opens on tap to edit.
export function Collapsible({ title, summary, open, onToggle, children }: CollapsibleProps) {
  const [own, setOwn] = useState(false);
  const isOpen = open ?? own;
  const toggle = () => (onToggle ?? setOwn)(!isOpen);
  return (
    <section class="card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <button class="fold" type="button" aria-expanded={isOpen} onClick={toggle}>
        <span class="eyebrow">{title}</span>
        <span class={`chev${isOpen ? ' up' : ''}`} aria-hidden="true">▾</span>
      </button>
      {isOpen ? children : <span style={{ fontWeight: 600 }}>{summary}</span>}
    </section>
  );
}
