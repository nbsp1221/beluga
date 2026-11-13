import { Bot, Minimize2, Settings2, UserRound, Wrench } from 'lucide-react';

export const trajectoryRoles = {
  system: {
    icon: Settings2,
    label: 'System',
    tag: 'bg-muted text-foreground',
    mark: 'bg-muted-foreground',
    lane: 0,
  },
  user: {
    icon: UserRound,
    label: 'User',
    tag: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
    mark: 'bg-blue-600 dark:bg-blue-400',
    lane: 0,
  },
  assistant: {
    icon: Bot,
    label: 'Assistant',
    tag: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200',
    mark: 'bg-violet-600 dark:bg-violet-400',
    lane: 1,
  },
  tool: {
    icon: Wrench,
    label: 'Tool',
    tag: 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-200',
    mark: 'bg-amber-700 dark:bg-amber-400',
    lane: 2,
  },
  compaction: {
    icon: Minimize2,
    label: 'Compact',
    tag: 'bg-muted text-foreground',
    mark: 'bg-muted-foreground',
    lane: 1,
  },
} as const;
