import { useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/features/auth/auth-provider';
import { toUserMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { colors, type } from '@/lib/theme';
import { AppButton } from '@/ui/button';
import { Screen } from '@/ui/screen';
import { AppTextField } from '@/ui/text-field';

export default function LoginScreen() {
  const { signIn, error } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const passwordInputRef = useRef<TextInput | null>(null);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setLocalError(null);
    try {
      const user = await signIn(email, password);
      router.replace(user.mustChangePassword ? '/(auth)/change-password' : '/tasks');
    } catch (cause) {
      setLocalError(toUserMessage(cause, 'Prijava nije uspjela.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}><Text style={styles.mark}>VP</Text><View><Text style={styles.brandTitle}>Vozni park</Text><Text style={styles.brandSubtitle}>Mobilni portal</Text></View></View>
          <View style={styles.card}>
            <Text style={styles.heading}>Prijava</Text>
            <Text style={styles.helper}>Prijavite se službenim korisničkim nalogom.</Text>
            <Text style={styles.label}>E-mail</Text>
            <AppTextField testID="login-email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" accessibilityLabel="E-mail" returnKeyType="next" blurOnSubmit={false} onSubmitEditing={() => passwordInputRef.current?.focus()} />
            <Text style={styles.label}>Lozinka</Text>
            <AppTextField ref={passwordInputRef} testID="login-password" value={password} onChangeText={setPassword} autoCapitalize="none" autoComplete="current-password" secureTextEntry textContentType="password" accessibilityLabel="Lozinka" onSubmitEditing={() => void submit()} returnKeyType="go" />
            {(localError ?? error) ? <Text testID="login-error" accessibilityRole="alert" style={styles.error}>{localError ?? error}</Text> : null}
            <AppButton testID="login-submit" label={submitting ? 'Prijavljujem…' : 'Prijavi se'} loading={submitting} disabled={!email || !password} onPress={() => void submit()} />
            <Text style={styles.notice}>{t('mobileAccessForbidden')}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 24, gap: 28 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'center' },
  mark: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.primary, color: colors.primaryFg, fontSize: 20, fontWeight: '800', textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden' },
  brandTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  brandSubtitle: { color: colors.muted, fontSize: 14, marginTop: 2, lineHeight: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: 22, gap: 12, borderWidth: 1, borderColor: colors.border },
  heading: { color: colors.ink, fontSize: 24, fontWeight: '800' },
  helper: { color: colors.muted, fontSize: 15, lineHeight: 22, marginBottom: 8 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 4 },
  error: { color: colors.danger, ...type.sm, lineHeight: 20 },
  notice: { color: colors.muted, ...type.sm, lineHeight: 20, textAlign: 'center', marginTop: 4 },
});
