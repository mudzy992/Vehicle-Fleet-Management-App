import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { buildRenderModel, collectSubmitValues, type RenderField, type RenderModel } from '@vfm/form-renderer/render-model';
import { parseDefinition } from '@vfm/form-engine/definition';
import { toLocalDateString } from '@vfm/shared';
import { useAuth } from '@/features/auth/auth-provider';
import { CreateTaskStepOne, CreateTaskStepThree, CreateTaskStepTwo } from '@/features/tasks/create-task-steps';
import { pickDocument, pickPhoto, uploadFiles } from '@/features/tasks/upload-picked';
import { ApiError, mobileApi, toUserMessage, type ActiveTaskForm, type MobileTaskType, type UserSummary, type VehicleSummary } from '@/lib/api';
import { dueAtFromDate } from '@/lib/format';
import { AppButton } from '@/ui/button';
import { colors, type } from '@/lib/theme';

type AssignMode = 'OPEN_CLAIM' | 'ASSIGN_DIRECT' | 'BROADCAST';

export function CreateTaskScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const canCreate = user?.permissions.includes('task:create') === true;
  const canViewUsers = user?.permissions.includes('user:view') === true;
  const canAssignDirect = canViewUsers && user?.permissions.includes('task:assign') === true;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [taskTypes, setTaskTypes] = useState<MobileTaskType[]>([]);
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [invitedUserIds, setInvitedUserIds] = useState<string[]>([]);
  const [observerUserIds, setObserverUserIds] = useState<string[]>([]);
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [taskTypeId, setTaskTypeId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [activeForm, setActiveForm] = useState<ActiveTaskForm | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [assignMode, setAssignMode] = useState<AssignMode>('BROADCAST');
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Array<{ key: string; code: string; message: string }>>([]);

  useEffect(() => {
    if (!canCreate) return;
    let active = true;
    setLoading(true);
    Promise.all([
      mobileApi.taskTypes(),
      user?.permissions.includes('vehicle:view') ? mobileApi.vehicles() : Promise.resolve({ items: [] as VehicleSummary[] }),
      canViewUsers ? mobileApi.users() : Promise.resolve({ items: [] as UserSummary[] }),
    ]).then(([typeResult, vehicleResult, userResult]) => {
      if (!active) return;
      setTaskTypes(typeResult.items);
      setVehicles(vehicleResult.items.filter((item) => item.status !== 'ARCHIVED'));
      setUsers(userResult.items.filter((item) => item.id !== user?.id));
      if (typeResult.items[0]) selectType(typeResult.items[0], canAssignDirect);
    }).catch((cause: unknown) => {
      if (active) setError(toUserMessage(cause, 'Podaci za kreiranje zadatka nisu dostupni.'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, canCreate]);

  const selectType = (item: MobileTaskType, assignOk = canAssignDirect) => {
    if (item.id === taskTypeId) return;
    setTaskTypeId(item.id);
    setPriority(item.defaultPriority);
    setAssignMode(item.defaultAssignMode === 'ASSIGN_DIRECT' && assignOk ? 'ASSIGN_DIRECT' : item.defaultAssignMode === 'OPEN_CLAIM' ? 'OPEN_CLAIM' : 'BROADCAST');
    setAssigneeUserId('');
    setInvitedUserIds([]);
    setObserverUserIds([]);
    setValues({});
    setActiveForm(null);
    setVehicleId('');
  };

  useEffect(() => {
    if (!taskTypeId) return;
    let active = true;
    setFormLoading(true);
    setError(null);
    mobileApi.activeTaskForm(taskTypeId, 'ORDER').then((form) => { if (active) setActiveForm(form); })
      .catch((cause: unknown) => { if (active) setError(toUserMessage(cause, 'Aktivna forma zadatka se nije mogla učitati.')); })
      .finally(() => { if (active) setFormLoading(false); });
    return () => { active = false; };
  }, [taskTypeId]);

  const selectedType = taskTypes.find((item) => item.id === taskTypeId) ?? null;
  const step2BlockReason = !activeForm ? 'form' : !activeForm.mobileCompatible ? 'compatibility' : selectedType?.requiresVehicle === true && !vehicleId ? 'vehicle' : null;
  const parsed = useMemo(() => activeForm ? parseDefinition(activeForm.definition) : null, [activeForm]);
  const model = useMemo<RenderModel | null>(() => {
    if (!activeForm || !parsed?.ok) return null;
    return buildRenderModel({ definition: parsed.definition, values, errors: fieldErrors, today: toLocalDateString(new Date()), version: activeForm.version, formSchemaVersionId: activeForm.formSchemaVersionId });
  }, [activeForm, parsed, values, fieldErrors]);

  const handleUpload = async (field: RenderField, source: 'CAMERA' | 'GALLERY' | 'FILE') => {
    try {
      const files = source === 'FILE' ? await pickDocument(field) : await pickPhoto(field, source);
      setUploadingField(field.key);
      await uploadFiles({ field, files, existing: values[field.key], canUpload: user?.permissions.includes('attachment:upload') === true, onValues: (ids) => setValues((current) => ({ ...current, [field.key]: ids })), onError: setError });
    } catch (cause) {
      setError(toUserMessage(cause, 'Upload priloga nije uspio.'));
    } finally {
      setUploadingField(null);
    }
  };

  const submit = async () => {
    if (!selectedType || !model || submitting) return;
    if (assignMode === 'ASSIGN_DIRECT' && (!assigneeUserId || !canAssignDirect)) { setError('Za direktnu dodjelu odaberite izvršioca.'); return; }
    if (assignMode === 'OPEN_CLAIM' && invitedUserIds.length === 0) { setError('Pozvanima treba lista korisnika. Za sve vozače odaberite Svima.'); return; }
    const dueAt = dueAtFromDate(dueDate);
    if (dueAt === null) { setError('Unesite rok kao dd.MM.yyyy, na primjer 22.10.2026.'); return; }
    setSubmitting(true);
    setError(null);
    setFieldErrors([]);
    try {
      const created = await mobileApi.createTask({
        taskTypeId: selectedType.id,
        vehicleId: selectedType.requiresVehicle ? vehicleId : null,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        priority,
        assignMode,
        ...(assignMode === 'ASSIGN_DIRECT' ? { assigneeUserId } : {}),
        ...(assignMode === 'OPEN_CLAIM' ? { invitedUserIds } : {}),
        observerUserIds,
        ...(dueAt ? { dueAt } : {}),
        orderFormData: collectSubmitValues(model),
      });
      router.replace({ pathname: '/task/[id]', params: { id: created.id } });
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(toUserMessage(cause, 'Zadatak nije moguće sačuvati.'));
        setFieldErrors((cause.details ?? []).flatMap((detail) => {
          const path = detail.path.join('.');
          return path.startsWith('formData.') ? [{ key: path.slice('formData.'.length), code: cause.code, message: detail.message }] : [];
        }));
      } else setError('Zadatak nije moguće kreirati. Pokušajte ponovo.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!canCreate) return <View style={styles.center}><Text accessibilityRole="alert" style={styles.error}>Nemate pravo za kreiranje zadataka.</Text></View>;
  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /><Text style={styles.muted}>Učitavanje podataka…</Text></View>;
  if (taskTypes.length === 0) return <View style={styles.center}><Text accessibilityRole="alert" style={styles.error}>{error ?? 'Nema aktivnih vrsta zadataka ili nemate dozvolu za pregled.'}</Text></View>;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Novi zadatak' }} />
      {step === 2 ? <View style={styles.stepBar}><AppButton testID="task-create-next-step-2" label="Nastavi na obrazac" disabled={step2BlockReason !== null} onPress={() => { setError(null); setStep(3); }} /></View> : null}
      <ScrollView style={styles.flex} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.heading}><Text style={styles.title}>Novi zadatak</Text><Text style={styles.muted}>Korak {step} od 3</Text></View>
        <View style={styles.progress}><View style={[styles.progressFill, { width: `${(step / 3) * 100}%` }]} /></View>
        {step === 1 ? <CreateTaskStepOne taskTypes={taskTypes} selectedType={selectedType} taskTypeId={taskTypeId} vehicleId={vehicleId} vehicles={vehicles} onSelectType={selectType} onSelectVehicle={setVehicleId} /> : null}
        {step === 2 ? (
          <CreateTaskStepTwo
            activeForm={activeForm} formLoading={formLoading} step2BlockReason={step2BlockReason}
            title={title} description={description} priority={priority} dueDate={dueDate} assignMode={assignMode}
            canAssignDirect={canAssignDirect} canViewUsers={canViewUsers} users={users} assigneeUserId={assigneeUserId}
            invitedUserIds={invitedUserIds} observerUserIds={observerUserIds}
            onTitle={setTitle} onDescription={setDescription} onPriority={setPriority} onDueDate={setDueDate}
            onAssignMode={(mode) => { setAssignMode(mode); if (mode !== 'ASSIGN_DIRECT') setAssigneeUserId(''); if (mode !== 'OPEN_CLAIM') setInvitedUserIds([]); }}
            onAssignee={(id) => { setAssigneeUserId(id); setObserverUserIds((current) => current.filter((item) => item !== id)); }}
            onToggleInvited={(id) => { setInvitedUserIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); setObserverUserIds((current) => current.filter((item) => item !== id)); }}
            onToggleObserver={(id) => setObserverUserIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])}
          />
        ) : null}
        {step === 3 ? (
          <CreateTaskStepThree formLoading={formLoading} model={model} values={values} submitting={submitting} uploadingField={uploadingField} canUpload={user?.permissions.includes('attachment:upload') ?? false} error={error} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} onCamera={(field) => void handleUpload(field, 'CAMERA')} onGallery={(field) => void handleUpload(field, 'GALLERY')} onDocument={(field) => void handleUpload(field, 'FILE')} />
        ) : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <View style={styles.actions}>
          {step > 1 ? <AppButton label="Nazad" variant="secondary" disabled={submitting || uploadingField !== null} onPress={() => setStep((current) => (current - 1) as 1 | 2 | 3)} /> : null}
          {step === 1 ? <AppButton testID="task-create-next-step-1" label="Nastavi" disabled={!selectedType || (selectedType.requiresVehicle && !vehicleId)} onPress={() => { setError(null); setStep(2); }} /> : null}
          {step === 3 ? <AppButton testID="task-create-submit" label={submitting ? 'Kreiram…' : 'Kreiraj zadatak'} disabled={!model || submitting || uploadingField !== null} loading={submitting} onPress={() => void submit()} /> : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: 18, gap: 14, paddingBottom: 140 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  muted: { color: colors.muted, ...type.sm, lineHeight: 19 },
  progress: { height: 6, backgroundColor: colors.surfaceMuted, borderRadius: 99, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 99 },
  stepBar: { paddingHorizontal: 18, paddingVertical: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 18, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  actions: { flexDirection: 'row', gap: 10 },
  error: { color: colors.danger, ...type.sm, lineHeight: 19 },
});
