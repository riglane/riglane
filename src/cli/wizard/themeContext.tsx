import { createContext, useContext } from 'react';
import { darkTheme, type Theme } from './themes.js';

export const ThemeContext = createContext<Theme>(darkTheme);
export const useTheme = (): Theme => useContext(ThemeContext);
