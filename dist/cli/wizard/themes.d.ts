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
export declare const darkTheme: Theme;
export declare const lightTheme: Theme;
export declare const THEMES: {
    readonly dark: Theme;
    readonly light: Theme;
};
export type ThemeName = keyof typeof THEMES;
