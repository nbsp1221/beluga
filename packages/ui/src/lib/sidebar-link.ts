import { cn } from 'cn';

// Routing owns aria-current; this shared recipe owns its visual feedback.
export function sidebarLinkClassName(className: string) {
  return cn(
    'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-sidebar-ring aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground',
    className,
  );
}
