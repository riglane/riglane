
export type Theme = {
  brand: string;
  accent: string;
  highlight: string;
  success: string;
  warning: string;
  danger: string;
  muted: string;
  body: undefined;
  hint: string;
  tabInactive: string;
};

export const darkTheme: Theme = {
  brand: '#CC785C',
  accent: 'cyan',
  highlight: 'yellow',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  muted: 'gray',
  body: undefined,
  hint: '#787878',
  tabInactive: 'white',
};

export const lightTheme: Theme = {
  brand: '#CC785C',
  accent: 'blue',
  highlight: '#d97706',
  success: 'green',
  warning: '#d97706',
  danger: 'red',
  muted: '#888888',
  body: undefined,
  hint: '#aaaaaa',
  tabInactive: 'black',
};

export const THEMES = { dark: darkTheme, light: lightTheme } as const;
export type ThemeName = keyof typeof THEMES;
