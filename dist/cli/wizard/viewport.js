import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { Box, Text, useStdout } from 'ink';
import { createContext, useContext, useEffect, useState } from 'react';
import { useTheme } from './themeContext.js';
export function windowAround(total, focus, capacity) {
    if (capacity <= 0 || total <= 0)
        return { start: 0, end: 0 };
    if (total <= capacity)
        return { start: 0, end: total };
    const f = Math.max(0, Math.min(focus, total - 1));
    let start = f - Math.floor(capacity / 2);
    if (start < 0)
        start = 0;
    if (start + capacity > total)
        start = total - capacity;
    return { start, end: start + capacity };
}
export function useTerminalRows() {
    const { stdout } = useStdout();
    const [rows, setRows] = useState(stdout?.rows ?? 24);
    useEffect(() => {
        if (!stdout)
            return undefined;
        let timeoutId;
        const onResize = () => {
            if (timeoutId)
                clearTimeout(timeoutId);
            timeoutId = setTimeout(() => setRows(stdout.rows ?? 24), 100);
        };
        stdout.on('resize', onResize);
        return () => {
            if (timeoutId)
                clearTimeout(timeoutId);
            stdout.off('resize', onResize);
        };
    }, [stdout]);
    return rows;
}
export const ViewportContext = createContext(Number.MAX_SAFE_INTEGER);
export function useViewportRows() {
    return useContext(ViewportContext);
}
export function MoreRow({ count, dir }) {
    const theme = useTheme();
    if (count <= 0)
        return null;
    return (_jsx(Box, { children: _jsxs(Text, { color: theme.muted, children: ['  ', dir === 'up' ? '↑' : '↓', " ", count, " more"] }) }));
}
