
export const theme = {
  brand: '#CC785C' as const,

  accent: 'cyan' as const,

  highlight: 'yellow' as const,

  success: 'green' as const,

  warning: 'yellow' as const,

  danger: 'red' as const,

  muted: 'gray' as const,

  hint: '#787878' as const,

  tabInactive: '#d8d8d8' as const,

  body: undefined as undefined,
};

export type ThemeColor = (typeof theme)[keyof typeof theme];

export const CURSOR = '❯';

export const CURSOR_GAP = ' ';
