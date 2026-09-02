
import { Box, Text } from 'ink';
import { useTheme } from './themeContext.js';
import type { Keybind } from './keybinds.js';

export interface HelpOverlayProps {
  title?: string;
  sections: Array<{ heading: string; keybinds: Keybind[] }>;
}

export function HelpOverlay({ title = 'Keyboard shortcuts', sections }: HelpOverlayProps): React.ReactElement {
  const theme = useTheme();
  return (
    <Box
      borderStyle="round"
      borderColor={theme.accent}
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <Box marginBottom={1}>
        <Text color={theme.accent} bold>
          {title}
        </Text>
      </Box>

      {sections.map((section, idx) => (
        <Box key={section.heading} flexDirection="column" marginBottom={idx === sections.length - 1 ? 0 : 1}>
          <Text color={theme.brand}>{section.heading}</Text>
          {section.keybinds.map((kb) => (
            <Box key={kb.key} paddingLeft={2}>
              <Box width={12}>
                <Text color={theme.highlight}>{kb.key}</Text>
              </Box>
              <Text color={theme.muted}>{kb.label}</Text>
            </Box>
          ))}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text color={theme.muted}>Press </Text>
        <Text color={theme.highlight}>?</Text>
        <Text color={theme.muted}> or </Text>
        <Text color={theme.highlight}>esc</Text>
        <Text color={theme.muted}> to dismiss</Text>
      </Box>
    </Box>
  );
}
