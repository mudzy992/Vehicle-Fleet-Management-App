import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { buildRenderModel, collectSubmitValues, type RenderField, type RenderModel } from '@vfm/form-renderer/render-model';
import { parseDefinition } from '@vfm/form-engine/definition';
import { FieldControl } from '@/features/tasks/dynamic-task-form';
import { useAuth } from '@/features/auth/auth-provider';
import { ApiError, mobileApi, toUserMessage, type ActiveTaskForm, type MobileTaskType, type UserSummary, type VehicleSummary } from '@/lib/api';
import { colors } from '@/lib/theme';

interface PickedFile { uri: string; name: string; mimeType: string }
type AssignMode = 'OPEN_CLAIM' | 'ASSIGN_DIRECT' | 'BROADCAST';

function todaySarajevo(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sarajevo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (part: string) => parts.find((item) => item.type === part)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function dueAtFromDate(value: string): string | undefined | null {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(trimmed)) return null;
  const date = new Date(`${trimmed}T23:59:00`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmed) return null;
  return date.toISOString();
}

export default function CreateTaskScreen() {
  const router = useRouter();
  const { user } = useAuth();
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
  const [assignMode, setAssignMode] = useState<AssignMode>('OPEN_CLAIM');
  const [dueDate, setDueDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Array<{ key: string; code: string; message: string }>>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      mobileApi.taskTypes(),
      user?.permissions.includes('vehicle:view') ? mobileApi.vehicles() : Promise.resolve({ items: [], page: 1, pageSize: 50, total: 0, totalPages: 0 }),
      canViewUsers ? mobileApi.users() : Promise.resolve({ items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 }),
    ]).then(([typeResult, vehicleResult, userResult]) => {
      if (!active) return;
      setTaskTypes(typeResult.items);
      setVehicles(vehicleResult.items.filter((item) => item.status !== 'ARCHIVED'));
      setUsers(userResult.items.filter((item) => item.id !== user?.id));
      if (typeResult.items[0]) selectType(typeResult.items[0]);
    }).catch((cause: unknown) => {
      if (active) setError(toUserMessage(cause, 'Podaci za kreiranje zadatka nisu dostupni.'));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id]);

  const selectType = (item: MobileTaskType) => {
    if (item.id === taskTypeId) return;
    setTaskTypeId(item.id);
    setPriority(item.defaultPriority);
    setAssignMode(item.defaultAssignMode === 'BROADCAST' ? 'BROADCAST' : item.defaultAssignMode === 'ASSIGN_DIRECT' && canAssignDirect ? 'ASSIGN_DIRECT' : 'OPEN_CLAIM');
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
    mobileApi.activeTaskForm(taskTypeId).then((form) => {
      if (active) setActiveForm(form);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Aktivna forma zadatka se nije mogla učitati.');
    }).finally(() => { if (active) setFormLoading(false); });
    return () => { active = false; };
  }, [taskTypeId]);

  const selectedType = taskTypes.find((item) => item.id === taskTypeId) ?? null;
  const step2BlockReason = !activeForm
    ? 'form'
    : !activeForm.mobileCompatible
      ? 'compatibility'
      : selectedType?.requiresVehicle === true && !vehicleId
        ? 'vehicle'
        : null;
  const parsed = useMemo(() => activeForm ? parseDefinition(activeForm.definition) : null, [activeForm]);
  const model = useMemo<RenderModel | null>(() => {
    if (!activeForm || !parsed?.ok) return null;
    return buildRenderModel({
      definition: parsed.definition,
      values,
      errors: fieldErrors,
      today: todaySarajevo(),
      version: activeForm.version,
      formSchemaVersionId: activeForm.formSchemaVersionId,
    });
  }, [activeForm, parsed, values, fieldErrors]);

  const uploadPicked = async (field: RenderField, files: PickedFile[]) => {
    if (!user?.permissions.includes('attachment:upload')) {
      setError('Za dodavanje fotografija i priloga potrebna je dozvola za upload.');
      return;
    }
    const existing = strings(values[field.key]);
    const maxFiles = typeof field.validation['maxFiles'] === 'number' ? field.validation['maxFiles'] : undefined;
    if (maxFiles !== undefined && files.length > Math.max(0, maxFiles - existing.length)) {
      setError(`Polje „${field.label}” prima najviše ${maxFiles} fajlova.`);
      return;
    }
    if (files.length === 0) return;
    setError(null);
    setUploadingField(field.key);
    try {
      const ids = [...existing];
      for (const file of files) {
        const result = await mobileApi.uploadAttachment(file.uri, file.name, file.mimeType);
        ids.push(result.id);
        setValues((current) => ({ ...current, [field.key]: [...ids] }));
      }
    } catch (cause) {
      setError(toUserMessage(cause, 'Upload priloga nije uspio.'));
    } finally {
      setUploadingField(null);
    }
  };

  const pickPhoto = async (field: RenderField, source: 'CAMERA' | 'GALLERY') => {
    try {
      if (source === 'CAMERA') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { setError('Dozvolite pristup kameri da biste fotografisali prilog.'); return; }
      }
      const result = source === 'CAMERA'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.82 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.82 });
      if (result.canceled) return;
      const configured = field.validation['mimeTypes'];
      const allowed = Array.isArray(configured) ? configured.filter((item): item is string => typeof item === 'string') : [];
      const mimeType = ['image/jpeg', 'image/png', 'image/webp'].find((item) => allowed.includes(item)) ?? 'image/jpeg';
      const format = mimeType === 'image/png' ? ImageManipulator.SaveFormat.PNG : mimeType === 'image/webp' ? ImageManipulator.SaveFormat.WEBP : ImageManipulator.SaveFormat.JPEG;
      const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
      const files: PickedFile[] = [];
      for (const [index, asset] of result.assets.entries()) {
        const image = await ImageManipulator.manipulateAsync(asset.uri, asset.width > 1600 ? [{ resize: { width: 1600 } }] : [], { compress: 0.78, format });
        files.push({ uri: image.uri, name: `prilog-${Date.now()}-${index + 1}.${extension}`, mimeType });
      }
      await uploadPicked(field, files);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Fotografiju nije moguće otvoriti.');
    }
  };

  const pickDocument = async (field: RenderField) => {
    try {
      const configured = field.validation['mimeTypes'];
      const result = await DocumentPicker.getDocumentAsync({ type: Array.isArray(configured) && configured.every((item) => typeof item === 'string') ? configured as string[] : '*/*', multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      await uploadPicked(field, result.assets.map((asset) => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream' })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Fajl nije moguće odabrati.');
    }
  };

  const continueFromDetails = () => {
    if (!selectedType) { setError('Odaberite vrstu zadatka.'); return; }
    if (selectedType.requiresVehicle && !vehicleId) { setError('Odaberite vozilo za ovu vrstu zadatka.'); return; }
    if (!activeForm?.mobileCompatible) { setError('Forma vrste zadatka nije označena kao kompatibilna s mobilnom aplikacijom.'); return; }
    setError(null);
    setStep(3);
  };

  const submit = async () => {
    if (!selectedType || !model || submitting) return;
    if (assignMode === 'ASSIGN_DIRECT' && !assigneeUserId) {
      setError('Odaberite direktnog izvršioca.');
      return;
    }
    if (assignMode === 'ASSIGN_DIRECT' && !canAssignDirect) {
      setError('Za direktnu dodjelu potrebne su dozvole task:assign i user:view.');
      return;
    }
    const dueAt = dueAtFromDate(dueDate);
    if (dueAt === null) {
      setError('Unesite rok u formatu GGGG-MM-DD, na primjer 2026-10-22.');
      return;
    }
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
        formData: collectSubmitValues(model),
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

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} size="large" /><Text style={styles.muted}>Učitavanje podataka…</Text></View>;
  if (taskTypes.length === 0) return <View style={styles.center}><Text accessibilityRole="alert" style={styles.error}>{error ?? 'Nema aktivnih vrsta zadataka ili nemate dozvolu za pregled.'}</Text></View>;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Novi zadatak' }} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={step === 2 ? [2] : []}
      >
        <View style={styles.heading}>
          <Text style={styles.title}>Novi zadatak</Text>
          <Text style={styles.muted}>Korak {step} od 3</Text>
        </View>
        <View style={styles.progress}><View style={[styles.progressFill, { width: `${(step / 3) * 100}%` }]} /></View>
        {step === 2 ? (
          <View style={styles.stickyAction}>
            <View style={styles.actions}>
              <ActionButton testID="task-create-next-step-2" label="Nastavi na obrazac" disabled={step2BlockReason !== null} onPress={continueFromDetails} />
            </View>
          </View>
        ) : null}

        {step === 1 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>1. Vrsta i vozilo</Text>
            <Text style={styles.label}>Vrsta zadatka</Text>
            <View style={styles.choices}>{taskTypes.map((item) => <Choice key={item.id} testID={`task-create-type-${item.code.toLowerCase()}`} active={item.id === taskTypeId} label={item.name} detail={item.description ?? item.code} onPress={() => selectType(item)} />)}</View>
            {selectedType?.requiresVehicle ? <>
              <Text style={styles.label}>Vozilo</Text>
              {vehicles.length ? <View style={styles.choices}>{vehicles.map((item) => <Choice key={item.id} testID={`task-create-vehicle-${item.internalNo.toLowerCase()}`} active={item.id === vehicleId} label={`${item.internalNo} · ${item.make} ${item.model}`} detail={item.plateNumber ?? 'Bez registarske oznake'} onPress={() => setVehicleId(item.id)} />)}</View> : <Text style={styles.error}>Nema vozila za izbor ili nemate dozvolu vehicle:view.</Text>}
            </> : <Text style={styles.muted}>Ova vrsta zadatka ne zahtijeva vozilo.</Text>}
          </View>
        ) : null}

        {step === 2 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>2. Detalji</Text>
            <Text style={styles.muted}>{selectedType?.name}{selectedType?.requiresVehicle && vehicleId ? ` · ${vehicles.find((item) => item.id === vehicleId)?.internalNo ?? ''}` : ''}</Text>
            {activeForm ? <Text testID="task-create-active-form" style={styles.muted}>{activeForm.name} · v{activeForm.version}</Text> : null}
            {formLoading ? <Text testID="task-create-form-loading" style={styles.muted}>Učitavanje obrasca…</Text> : null}
            {activeForm?.mobileCompatible ? <Text testID="task-create-form-ready" style={styles.muted}>Obrazac je spreman za mobilno kreiranje.</Text> : null}
            {step2BlockReason === 'vehicle' ? <Text testID="task-create-step2-blocked-vehicle" style={styles.error}>Odaberite vozilo prije nastavka.</Text> : null}
            {activeForm && !activeForm.mobileCompatible ? <Text testID="task-create-form-incompatible" style={styles.error}>Objavljena forma nije označena kao kompatibilna s mobilnom aplikacijom.</Text> : null}
            {!step2BlockReason ? <Text testID="task-create-step2-ready" style={styles.muted}>Obrazac i vozilo su spremni.</Text> : null}
            <Text style={styles.label}>Naslov (opciono)</Text>
            <TextInput testID="task-create-title" accessibilityLabel="Naslov zadatka" value={title} onChangeText={setTitle} placeholder="Automatski se predlaže iz vrste i vozila" maxLength={160} style={styles.input} />
            <Text style={styles.label}>Opis (opciono)</Text>
            <TextInput value={description} onChangeText={setDescription} placeholder="Dodatne upute" multiline maxLength={2000} style={[styles.input, styles.textarea]} />
            <Text style={styles.label}>Prioritet</Text>
            <View style={styles.choices}>{(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((item) => <Choice key={item} active={priority === item} label={item === 'LOW' ? 'Nizak' : item === 'HIGH' ? 'Visok' : item === 'URGENT' ? 'Hitno' : 'Normalan'} onPress={() => setPriority(item)} />)}</View>
            <Text style={styles.label}>Rok (opciono, GGGG-MM-DD)</Text>
            <TextInput value={dueDate} onChangeText={setDueDate} placeholder={todaySarajevo()} keyboardType="numbers-and-punctuation" style={styles.input} />
            <Text style={styles.label}>Način dodjele</Text>
            <View style={styles.choices}>
              <Choice active={assignMode === 'OPEN_CLAIM'} label="Preuzimanje" detail="Zadatak ostaje slobodan za preuzimanje." onPress={() => { setAssignMode('OPEN_CLAIM'); setAssigneeUserId(''); }} />
              {canAssignDirect ? <Choice active={assignMode === 'ASSIGN_DIRECT'} label="Direktna dodjela" detail="Odaberite jednog izvršioca." onPress={() => { setAssignMode('ASSIGN_DIRECT'); setInvitedUserIds([]); }} /> : null}
              <Choice active={assignMode === 'BROADCAST'} label="Objava svima" detail="Vidljiv je korisnicima s dozvolom za preuzimanje." onPress={() => { setAssignMode('BROADCAST'); setAssigneeUserId(''); setInvitedUserIds([]); }} />
            </View>
            {assignMode === 'ASSIGN_DIRECT' ? (
              <>
                <Text style={styles.label}>Izvršilac *</Text>
                {users.length ? <View style={styles.choices}>{users.map((item) => <Choice key={item.id} active={assigneeUserId === item.id} label={item.displayName ?? `${item.firstName} ${item.lastName}`} onPress={() => { setAssigneeUserId(item.id); setObserverUserIds((current) => current.filter((id) => id !== item.id)); }} />)}</View> : <Text style={styles.error}>Nema aktivnih korisnika za izbor ili nemate dozvolu user:view.</Text>}
              </>
            ) : null}
            {assignMode === 'OPEN_CLAIM' && canViewUsers ? (
              <>
                <Text style={styles.label}>Pozvani korisnici (opciono)</Text>
                <Text style={styles.muted}>Pozvani korisnici mogu preuzeti zadatak prije ostalih.</Text>
                <View style={styles.choices}>{users.map((item) => <Choice key={item.id} active={invitedUserIds.includes(item.id)} selectionRole="checkbox" label={item.displayName ?? `${item.firstName} ${item.lastName}`} onPress={() => { setInvitedUserIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id]); setObserverUserIds((current) => current.filter((id) => id !== item.id)); }} />)}</View>
              </>
            ) : null}
            {canViewUsers ? (
              <>
                <Text style={styles.label}>Posmatrači (opciono)</Text>
                <View style={styles.choices}>{users.filter((item) => item.id !== assigneeUserId && !invitedUserIds.includes(item.id)).map((item) => <Choice key={item.id} active={observerUserIds.includes(item.id)} selectionRole="checkbox" label={item.displayName ?? `${item.firstName} ${item.lastName}`} onPress={() => setObserverUserIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} />)}</View>
              </>
            ) : null}
          </View>
        ) : null}

        {step === 3 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>3. Obrazac</Text>
            <Text style={styles.muted}>{activeForm?.name} · v{activeForm?.version}</Text>
            {formLoading ? <ActivityIndicator color={colors.primary} /> : model ? model.sections.map((section) => section.visible ? (
              <View key={section.key} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                {section.description ? <Text style={styles.muted}>{section.description}</Text> : null}
                {section.fields.map((field) => <FieldControl key={field.key} field={field} value={values[field.key]} disabled={submitting || uploadingField !== null || field.disabled} onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))} onCamera={() => void pickPhoto(field, 'CAMERA')} onGallery={() => void pickPhoto(field, 'GALLERY')} onDocument={() => void pickDocument(field)} canUpload={user?.permissions.includes('attachment:upload') ?? false} uploading={uploadingField === field.key} />)}
              </View>
            ) : null) : <Text accessibilityRole="alert" style={styles.error}>{error ?? 'Obrazac se ne može prikazati.'}</Text>}
          </View>
        ) : null}

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <View style={styles.actionFooter}>
        <View style={styles.actions}>
          {step > 1 ? <ActionButton label="Nazad" secondary disabled={submitting || uploadingField !== null} onPress={() => setStep((current) => (current - 1) as 1 | 2 | 3)} /> : null}
          {step === 1 ? <ActionButton testID="task-create-next-step-1" label="Nastavi" disabled={!selectedType || (selectedType.requiresVehicle && !vehicleId)} onPress={() => { setError(null); setStep(2); }} /> : null}
          {step === 3 ? <ActionButton testID="task-create-submit" label={submitting ? 'Kreiram…' : 'Kreiraj zadatak'} disabled={!model || submitting || uploadingField !== null} onPress={() => void submit()} /> : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Choice({ active, label, detail, onPress, selectionRole = 'radio', testID }: { active: boolean; label: string; detail?: string; selectionRole?: 'radio' | 'checkbox'; testID?: string; onPress(): void }) {
  return <Pressable testID={testID} accessibilityLabel={label} onPress={onPress} accessibilityRole={selectionRole} accessibilityState={{ selected: active }} style={[styles.choice, active && styles.choiceActive]}><Text style={[styles.choiceLabel, active && styles.choiceLabelActive]}>{label}</Text>{detail ? <Text style={styles.choiceDetail}>{detail}</Text> : null}</Pressable>;
}

function ActionButton({ label, onPress, disabled = false, secondary = false, testID }: { label: string; onPress(): void; disabled?: boolean; secondary?: boolean; testID?: string }) {
  return <Pressable testID={testID} accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ disabled }} onPress={onPress} disabled={disabled} style={[styles.action, secondary && styles.actionSecondary, disabled && styles.disabled]}><Text style={[styles.actionText, secondary && styles.actionTextSecondary]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { padding: 18, gap: 14, paddingBottom: 140 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  progress: { height: 6, backgroundColor: '#E9EEF2', borderRadius: 99, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: colors.primary, borderRadius: 99 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 4 },
  input: { minHeight: 46, borderColor: colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, fontSize: 15, backgroundColor: '#fff' },
  textarea: { minHeight: 86, textAlignVertical: 'top' },
  choices: { gap: 8 },
  choice: { borderWidth: 1, borderColor: colors.border, borderRadius: 11, padding: 12, backgroundColor: '#fff', gap: 4 },
  choiceActive: { borderColor: colors.primary, backgroundColor: '#E8F3F0' },
  choiceLabel: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  choiceLabelActive: { color: colors.primaryDark },
  choiceDetail: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  section: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 12 },
  stickyAction: { backgroundColor: colors.surface, zIndex: 10, elevation: 6, paddingVertical: 6 },
  actionFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 10, elevation: 8, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 18, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  actions: { flexDirection: 'row', gap: 10 },
  action: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 14 },
  actionSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  actionText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  actionTextSecondary: { color: colors.ink },
  disabled: { opacity: 0.5 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
});
