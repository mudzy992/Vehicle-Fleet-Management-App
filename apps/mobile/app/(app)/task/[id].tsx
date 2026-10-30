import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { statusLabel } from '@vfm/shared';
import { useAuth } from '@/features/auth/auth-provider';
import { DynamicTaskForm } from '@/features/tasks/dynamic-task-form';
import { mobileApi, toUserMessage, type TaskDetail } from '@/lib/api';
import { displayDateTime } from '@/lib/format';
import { colors, space } from '@/lib/theme';
import { Card } from '@/ui/card';
import { ErrorBanner } from '@/ui/error-banner';
import { StatusBadge } from '@/ui/status-badge';

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    setLoading(true);
    try { setTask(await mobileApi.task(id)); }
    catch (cause) { setError(toUserMessage(cause, 'Detalji zadatka se nisu mogli učitati.')); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [id]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /></View>;
  if (!task) return <View style={styles.center}><ErrorBanner message={error ?? 'Zadatak nije pronađen.'} onRetry={() => void load()} /></View>;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Stack.Screen options={{ title: task.code }} />
      <Card>
        <Text style={styles.type}>{task.taskTypeName}</Text>
        <Text style={styles.title}>{task.title}</Text>
        <Text style={task.description ? styles.description : styles.empty}>{task.description || 'Opis nije naveden.'}</Text>
        <View style={styles.badges}>
          <StatusBadge value={task.status} domain="taskStatus" />
          <StatusBadge value={task.priority} domain="taskPriority" />
        </View>
        <Info label="Vozilo" value={task.vehicleInternalNo ?? 'Nije vezano za vozilo'} />
        {task.vehicleId ? (
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/vehicle/[id]', params: { id: task.vehicleId! } })}>
            <Text style={styles.link}>Pregledaj vozilo</Text>
          </Pressable>
        ) : null}
        <Info label="Rok" value={displayDateTime(task.dueAt) ?? 'Nije postavljen'} />
        <Info label="Verzija obrasca" value={`${task.formSchemaName} · v${task.formSchemaVersion}`} />
        <Info label="Prioritet" value={statusLabel(task.priority, 'taskPriority')} />
      </Card>
      {error ? <ErrorBanner message={error} /> : null}
      <DynamicTaskForm
        task={task}
        canClaim={user?.permissions.includes('task:claim') ?? false}
        canComplete={user?.permissions.includes('task:complete') === true || user?.permissions.includes('task:complete_override') === true}
        canUpload={user?.permissions.includes('attachment:upload') ?? false}
        onTaskUpdated={setTask}
        onBack={() => router.back()}
      />
    </ScrollView>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <View style={styles.info}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  page: { padding: space[4], gap: space[3] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  type: { color: colors.primary, fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  title: { color: colors.ink, fontSize: 23, fontWeight: '800' },
  description: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  empty: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  badges: { flexDirection: 'row', gap: 8 },
  info: { gap: 3 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  value: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  link: { color: colors.primary, fontWeight: '700', minHeight: 48, textAlignVertical: 'center' },
});
