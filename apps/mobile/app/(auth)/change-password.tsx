import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/features/auth/auth-provider';
import { ApiError, mobileApi } from '@/lib/api';
import { colors } from '@/lib/theme';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [changed, setChanged] = useState(false);

  const submit = async () => {
    if (submitting) return;
    setError(null);
    if (newPassword !== confirmation) {
      setError('Nova lozinka i potvrda se ne podudaraju.');
      return;
    }
    setSubmitting(true);
    try {
      await mobileApi.changePassword(currentPassword, newPassword);
      await signOut();
      setChanged(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
    } catch (cause) {
      const details = cause instanceof ApiError ? cause.details?.map((item) => item.message).join(' ') : undefined;
      setError(details || (cause instanceof Error ? cause.message : 'Lozinku nije moguće promijeniti.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.card}>
        <Text style={styles.mark}>VP</Text>
        <Text style={styles.title}>{changed ? 'Lozinka je promijenjena' : 'Promjena privremene lozinke'}</Text>
        <Text style={styles.help}>
          {changed
            ? 'Zbog sigurnosti su sesije zatvorene. Prijavite se ponovo novom lozinkom.'
            : 'Prije nastavka postavite svoju lozinku. Mora imati najmanje 12 znakova i sadržavati znakove iz najmanje 3 grupe: mala slova, velika slova, cifre i simboli.'}
        </Text>
        {changed ? (
          <Pressable accessibilityRole="button" onPress={() => router.replace('/(auth)/login')} style={styles.button}>
            <Text style={styles.buttonText}>Prijavi se ponovo</Text>
          </Pressable>
        ) : (
          <>
            <Text style={styles.label}>Trenutna privremena lozinka</Text>
            <TextInput value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" accessibilityLabel="Trenutna privremena lozinka" style={styles.input} />
            <Text style={styles.label}>Nova lozinka</Text>
            <TextInput value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" accessibilityLabel="Nova lozinka" style={styles.input} />
            <Text style={styles.label}>Potvrda nove lozinke</Text>
            <TextInput value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" accessibilityLabel="Potvrda nove lozinke" style={styles.input} onSubmitEditing={() => void submit()} returnKeyType="go" />
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" onPress={() => void submit()} disabled={submitting || !currentPassword || !newPassword || !confirmation} style={({ pressed }) => [styles.button, (pressed || submitting) && styles.pressed, (!currentPassword || !newPassword || !confirmation) && styles.disabled]}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Promijeni lozinku</Text>}
            </Pressable>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', paddingHorizontal: 22 },
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: 22, gap: 12, borderWidth: 1, borderColor: colors.border },
  mark: { alignSelf: 'center', width: 48, height: 48, overflow: 'hidden', borderRadius: 15, backgroundColor: colors.primary, color: '#fff', fontSize: 19, fontWeight: '800', textAlign: 'center', textAlignVertical: 'center' },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  help: { color: colors.muted, fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 4 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 3 },
  input: { minHeight: 50, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, color: colors.ink, fontSize: 16, backgroundColor: '#fff' },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  button: { minHeight: 52, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.84 },
  disabled: { opacity: 0.55 },
});
