import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/features/auth/auth-provider';
import { DynamicTaskForm } from '@/features/tasks/dynamic-task-form';
import { mobileApi, toUserMessage, type TaskDetail } from '@/lib/api';
import { colors } from '@/lib/theme';

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try { setTask(await mobileApi.task(id)); }
    catch (cause) { setError(toUserMessage(cause, 'Detalji zadatka se nisu mogli učitati.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [id]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>;
  if (!task) return <View style={styles.center}><Text style={styles.error}>{error ?? 'Zadatak nije pronađen.'}</Text><Pressable onPress={() => void load()}><Text style={styles.actionLink}>Pokušaj ponovo</Text></Pressable></View>;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: task.code }} />
      <View style={styles.card}>
        <Text style={styles.type}>{task.taskTypeName}</Text>
        <Text style={styles.title}>{task.title}</Text>
        <Text style={styles.description}>{task.description || 'Opis nije naveden.'}</Text>
        <View style={styles.divider} />
        <Info label="Status" value={task.status === 'OPEN' ? 'Slobodan' : task.status === 'IN_PROGRESS' ? 'U toku' : task.status} />
        <Info label="Prioritet" value={task.priority} />
        <Info label="Vozilo" value={task.vehicleInternalNo ?? 'Nije vezano za vozilo'} />
        <Info label="Rok" value={task.dueAt ? new Intl.DateTimeFormat('bs-BA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Sarajevo' }).format(new Date(task.dueAt)) : 'Nije postavljen'} />
        <Info label="Verzija obrasca" value={`${task.formSchemaName} · v${task.formSchemaVersion}`} />
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <DynamicTaskForm
        task={task}
        canClaim={user?.permissions.includes('task:claim') ?? false}
        canComplete={user?.permissions.includes('task:complete') === true || user?.permissions.includes('task:complete_override') === true}
        canUpload={user?.permissions.includes('attachment:upload') ?? false}
        onTaskUpdated={setTask}
      />
    </ScrollView>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <View style={styles.info}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({ page: { padding: 18, gap: 14 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }, card: { backgroundColor: colors.surface, borderRadius: 18, borderColor: colors.border, borderWidth: 1, padding: 18, gap: 14 }, type: { color: colors.primary, fontSize: 13, fontWeight: '800', textTransform: 'uppercase' }, title: { color: colors.ink, fontSize: 23, fontWeight: '800' }, description: { color: colors.muted, fontSize: 15, lineHeight: 22 }, divider: { height: 1, backgroundColor: colors.border }, info: { gap: 3 }, label: { color: colors.muted, fontSize: 12, fontWeight: '600' }, value: { color: colors.ink, fontSize: 15, fontWeight: '600' }, error: { color: colors.danger, textAlign: 'center' }, actionLink: { color: colors.primary, fontWeight: '700', padding: 10 } });
