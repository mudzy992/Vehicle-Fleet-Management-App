import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/features/auth/auth-provider';
import { ApiError, mobileApi, toUserMessage } from '@/lib/api';
import { colors } from '@/lib/theme';
import { AppButton } from '@/ui/button';
import { Screen } from '@/ui/screen';
import { AppTextField } from '@/ui/text-field';

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { signOut, user } = useAuth();
  const isRequiredChange = user?.mustChangePassword === true;
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
      setError(details || toUserMessage(cause, 'Lozinku nije moguće promijeniti.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.mark}>VP</Text>
            <Text style={styles.title}>
              {changed ? 'Lozinka je promijenjena' : isRequiredChange ? 'Promjena privremene lozinke' : 'Promjena lozinke'}
            </Text>
            <Text style={styles.help}>
              {changed
                ? 'Zbog sigurnosti su sesije zatvorene. Prijavite se ponovo novom lozinkom.'
                : `${isRequiredChange ? 'Prije nastavka postavite svoju lozinku. ' : 'Unesite trenutnu lozinku i postavite novu. '}Nova lozinka mora imati najmanje 12 znakova i sadržavati znakove iz najmanje 3 grupe: mala slova, velika slova, cifre i simboli.`}
            </Text>
            {changed ? (
              <AppButton label="Prijavi se ponovo" onPress={() => router.replace('/(auth)/login')} />
            ) : (
              <>
                <Text style={styles.label}>{isRequiredChange ? 'Trenutna privremena lozinka' : 'Trenutna lozinka'}</Text>
                <AppTextField value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" accessibilityLabel={isRequiredChange ? 'Trenutna privremena lozinka' : 'Trenutna lozinka'} />
                <Text style={styles.label}>Nova lozinka</Text>
                <AppTextField value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" accessibilityLabel="Nova lozinka" />
                <Text style={styles.label}>Potvrda nove lozinke</Text>
                <AppTextField value={confirmation} onChangeText={setConfirmation} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" accessibilityLabel="Potvrda nove lozinke" onSubmitEditing={() => void submit()} returnKeyType="go" />
                {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
                <AppButton label="Promijeni lozinku" loading={submitting} disabled={!currentPassword || !newPassword || !confirmation} onPress={() => void submit()} />
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 20, padding: 22, gap: 12, borderWidth: 1, borderColor: colors.border },
  mark: { alignSelf: 'center', width: 48, height: 48, overflow: 'hidden', borderRadius: 15, backgroundColor: colors.primary, color: colors.primaryFg, fontSize: 19, fontWeight: '800', textAlign: 'center', textAlignVertical: 'center' },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  help: { color: colors.muted, fontSize: 15, lineHeight: 22, textAlign: 'center', marginBottom: 4 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 3 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
