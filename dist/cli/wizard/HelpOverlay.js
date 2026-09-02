import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { useTheme } from './themeContext.js';
export function HelpOverlay({ title = 'Keyboard shortcuts', sections }) {
    const theme = useTheme();
    return (_jsxs(Box, { borderStyle: "round", borderColor: theme.accent, flexDirection: "column", paddingX: 2, paddingY: 1, children: [_jsx(Box, { marginBottom: 1, children: _jsx(Text, { color: theme.accent, bold: true, children: title }) }), sections.map((section, idx) => (_jsxs(Box, { flexDirection: "column", marginBottom: idx === sections.length - 1 ? 0 : 1, children: [_jsx(Text, { color: theme.brand, children: section.heading }), section.keybinds.map((kb) => (_jsxs(Box, { paddingLeft: 2, children: [_jsx(Box, { width: 12, children: _jsx(Text, { color: theme.highlight, children: kb.key }) }), _jsx(Text, { color: theme.muted, children: kb.label })] }, kb.key)))] }, section.heading))), _jsxs(Box, { marginTop: 1, children: [_jsx(Text, { color: theme.muted, children: "Press " }), _jsx(Text, { color: theme.highlight, children: "?" }), _jsx(Text, { color: theme.muted, children: " or " }), _jsx(Text, { color: theme.highlight, children: "esc" }), _jsx(Text, { color: theme.muted, children: " to dismiss" })] })] }));
}
