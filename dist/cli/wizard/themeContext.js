import { createContext, useContext } from 'react';
import { darkTheme } from './themes.js';
export const ThemeContext = createContext(darkTheme);
export const useTheme = () => useContext(ThemeContext);
