import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';
import { colors, controlMinHeight, radius, space } from '@/lib/theme';

export const AppTextField = forwardRef<TextInput, TextInputProps>(function AppTextField(props, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.muted}
      selectionColor={colors.primary}
      cursorColor={colors.primary}
      keyboardAppearance="dark"
      {...props}
      onFocus={(event) => {
        setFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        props.onBlur?.(event);
      }}
      style={[styles.input, focused && styles.focused, props.style]}
    />
  );
});

const styles = StyleSheet.create({
  input: {
    minHeight: controlMinHeight,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    paddingVertical: 10,
    color: colors.ink,
    fontSize: 16,
    backgroundColor: colors.surfaceMuted,
  },
  focused: { borderColor: colors.primary },
});
