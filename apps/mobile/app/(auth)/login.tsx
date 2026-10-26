import { useState } from 'react';
import { useRouter } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '@/features/auth/auth-provider';
import { toUserMessage } from '@/lib/api';
import { colors } from '@/lib/theme';

export default function LoginScreen() {
  const { signIn, error } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setLocalError(null);
    try {
      const user = await signIn(email, password);
      router.replace(user.mustChangePassword ? '/(auth)/change-password' : '/(tabs)/tasks');
    } catch (cause) {
      setLocalError(toUserMessage(cause, 'Prijava nije uspjela.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.brand}><Text style={styles.mark}>VP</Text><View><Text style={styles.brandTitle}>Vozni park</Text><Text style={styles.brandSubtitle}>Mobilni portal</Text></View></View>
      <View style={styles.card}>
        <Text style={styles.heading}>Prijava</Text>
        <Text style={styles.helper}>Prijavite se službenim korisničkim nalogom.</Text>
        <Text style={styles.label}>E-mail</Text>
        <TextInput testID="login-email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" accessibilityLabel="E-mail" style={styles.input} returnKeyType="next" />
        <Text style={styles.label}>Lozinka</Text>
        <TextInput testID="login-password" value={password} onChangeText={setPassword} autoCapitalize="none" autoComplete="current-password" secureTextEntry textContentType="password" accessibilityLabel="Lozinka" style={styles.input} onSubmitEditing={() => void submit()} returnKeyType="go" />
        {(localError ?? error) ? <Text accessibilityRole="alert" style={styles.error}>{localError ?? error}</Text> : null}
        <Pressable testID="login-submit" accessibilityRole="button" accessibilityState={{ disabled: submitting }} onPress={() => void submit()} disabled={submitting || !email || !password} style={({ pressed }) => [styles.button, (pressed || submitting) && styles.buttonPressed, (!email || !password) && styles.buttonDisabled]}>
          <Text style={styles.buttonText}>{submitting ? 'Prijavljujem…' : 'Prijavi se'}</Text>
        </Pressable>
        <Text style={styles.notice}>Pristup mobilnoj aplikaciji provjerava server. Super Admin nalozi koriste web portal.</Text>
      </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 24, gap: 28 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'center' },
  mark: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.primary, color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden' },
  brandTitle: { color: colors.ink, fontSize: 22, fontWeight: '800' }, brandSubtitle: { color: colors.muted, fontSize: 14, marginTop: 2 },
  card: { backgroundColor: '#fff', borderRadius: 20, padding: 22, gap: 12, shadowColor: '#102a43', shadowOpacity: 0.08, shadowRadius: 18, elevation: 3 },
  heading: { color: colors.ink, fontSize: 24, fontWeight: '800' }, helper: { color: colors.muted, fontSize: 14, marginBottom: 8 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 4 },
  input: { minHeight: 50, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, color: colors.ink, fontSize: 16 },
  error: { color: colors.danger, fontSize: 14 },
  button: { minHeight: 52, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 }, buttonPressed: { opacity: 0.85 }, buttonDisabled: { opacity: 0.55 }, buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  notice: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 4 },
});
