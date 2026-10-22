import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { buildRenderModel, collectSubmitValues, type RenderField, type RenderModel } from '@vfm/form-renderer/render-model';
import { parseDefinition } from '@vfm/form-engine/definition';
import { ApiError, mobileApi, toUserMessage, type TaskDetail } from '@/lib/api';
import { colors } from '@/lib/theme';

interface Props {
  task: TaskDetail;
  canClaim: boolean;
  canComplete: boolean;
  canUpload: boolean;
  onTaskUpdated(task: TaskDetail): void;
}

interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
}

function sarajevoToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sarajevo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function moneyText(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  const amount = (value as { amount?: unknown }).amount;
  return typeof amount === 'number' ? (amount / 100).toFixed(2) : '';
}

function fieldText(field: RenderField): string {
  if (field.widget === 'MONEY') return moneyText(field.value);
  if (field.value === null || field.value === undefined) return '';
  if (typeof field.value === 'string' || typeof field.value === 'number') return String(field.value);
  return '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function DynamicTaskForm({ task, canClaim, canComplete, canUpload, onTaskUpdated }: Props) {
  const [snapshot, setSnapshot] = useState<{ definition: unknown; version: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, unknown>>(task.formData ?? {});
  const [busy, setBusy] = useState(false);
  const [activeUpload, setActiveUpload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Array<{ key: string; code: string; message: string }>>([]);
  const [comment, setComment] = useState('');
  const [odometer, setOdometer] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    mobileApi.formVersion(task).then((result) => {
      if (active) setSnapshot({ definition: result.definition, version: result.version });
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Snapshot forme se nije mogao učitati.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [task.formSchemaId, task.formSchemaVersionId]);

  useEffect(() => {
    setValues(task.formData ?? {});
    setFieldErrors([]);
    setError(null);
  }, [task.id, task.status, task.version]);

  const parsed = useMemo(() => snapshot ? parseDefinition(snapshot.definition) : null, [snapshot]);
  const model = useMemo<RenderModel | null>(() => {
    if (!parsed?.ok || !snapshot) return null;
    return buildRenderModel({
      definition: parsed.definition,
      values,
      errors: fieldErrors,
      today: sarajevoToday(),
      version: snapshot.version,
      formSchemaVersionId: task.formSchemaVersionId,
    });
  }, [parsed, snapshot, values, fieldErrors, task.formSchemaVersionId]);

  const uploadPicked = async (field: RenderField, files: PickedFile[]) => {
    if (!canUpload) {
      setError('Za dodavanje fotografija i priloga potrebna je dozvola za upload.');
      return;
    }
    const existing = stringArray(values[field.key]);
    const maxFiles = typeof field.validation['maxFiles'] === 'number' ? field.validation['maxFiles'] : undefined;
    const remaining = maxFiles === undefined ? files.length : Math.max(0, maxFiles - existing.length);
    if (files.length > remaining) {
      setError(`Polje „${field.label}” prima najviše ${maxFiles} fajlova.`);
      return;
    }
    if (files.length === 0) return;
    setError(null);
    setActiveUpload(field.key);
    try {
      const ids = [...existing];
      for (const file of files) {
        const upload = await mobileApi.uploadAttachment(file.uri, file.name, file.mimeType);
        ids.push(upload.id);
        setValues((current) => ({ ...current, [field.key]: [...ids] }));
      }
    } catch (cause) {
      setError(toUserMessage(cause, 'Upload fajla nije uspio. Pokušajte ponovo.'));
    } finally {
      setActiveUpload(null);
    }
  };

  const pickPhoto = async (field: RenderField, source: 'CAMERA' | 'GALLERY') => {
    try {
      if (source === 'CAMERA') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError('Dozvolite pristup kameri da biste fotografisali prilog.');
          return;
        }
      }
      const result = source === 'CAMERA'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.82 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.82 });
      if (result.canceled) return;
      const configuredTypes = field.validation['mimeTypes'];
      const allowedTypes = Array.isArray(configuredTypes) ? configuredTypes.filter((item): item is string => typeof item === 'string') : [];
      const mimeType = ['image/jpeg', 'image/png', 'image/webp'].find((type) => allowedTypes.includes(type)) ?? 'image/jpeg';
      const format = mimeType === 'image/png' ? ImageManipulator.SaveFormat.PNG : mimeType === 'image/webp' ? ImageManipulator.SaveFormat.WEBP : ImageManipulator.SaveFormat.JPEG;
      const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
      const files: PickedFile[] = [];
      for (const [index, asset] of result.assets.entries()) {
        const compressed = await ImageManipulator.manipulateAsync(
          asset.uri,
          asset.width > 1600 ? [{ resize: { width: 1600 } }] : [],
          { compress: 0.78, format },
        );
        files.push({ uri: compressed.uri, name: `fotografija-${Date.now()}-${index + 1}.${extension}`, mimeType });
      }
      await uploadPicked(field, files);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Fotografiju nije moguće otvoriti.');
    }
  };

  const pickDocument = async (field: RenderField) => {
    try {
      const allowed = field.validation['mimeTypes'];
      const result = await DocumentPicker.getDocumentAsync({
        type: Array.isArray(allowed) && allowed.every((item) => typeof item === 'string') ? allowed as string[] : '*/*',
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      await uploadPicked(field, result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
      })));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Fajl nije moguće odabrati.');
    }
  };

  const submit = async (action: 'CLAIM' | 'COMPLETE') => {
    if (!model || busy) return;
    setBusy(true);
    setError(null);
    setFieldErrors([]);
    try {
      const formData = collectSubmitValues(model);
      const updated = action === 'CLAIM'
        ? await mobileApi.claimTask(task.id, formData)
        : await mobileApi.completeTask(task.id, task.version, formData, {
            ...(comment.trim() ? { comment: comment.trim() } : {}),
            ...(odometer.trim() ? { odometerKm: Number(odometer) } : {}),
          });
      setValues(updated.formData ?? {});
      setComment('');
      setOdometer('');
      onTaskUpdated(updated);
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(toUserMessage(cause, 'Zadatak nije moguće ažurirati.'));
        setFieldErrors((cause.details ?? []).flatMap((detail) => {
          const path = detail.path.join('.');
          return path.startsWith('formData.') ? [{ key: path.slice('formData.'.length), code: cause.code, message: detail.message }] : [];
        }));
      } else {
        setError(action === 'CLAIM' ? 'Preuzimanje zadatka nije uspjelo.' : 'Završetak zadatka nije uspio.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Učitavanje snapshotovane forme…</Text></View>;
  if (error && !snapshot) return <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>{error}</Text></View>;
  if (!model) return <View style={styles.state}><Text accessibilityRole="alert" style={styles.error}>Definicija forme nije ispravna ili se ne može prikazati.</Text></View>;

  const isOpen = task.status === 'OPEN';
  const isInProgress = task.status === 'IN_PROGRESS';
  const canSubmit = isOpen ? canClaim : isInProgress && canComplete;
  const submitLabel = isOpen ? 'Preuzmi zadatak' : 'Završi zadatak';

  return (
    <View style={styles.wrap}>
      <View style={styles.formHeading}>
        <Text style={styles.formTitle}>{isOpen ? 'Podaci pri preuzimanju' : 'Obrazac zadatka'}</Text>
        <Text style={styles.muted}>Snapshot obrasca v{snapshot?.version} · {model.progress.filledRequired}/{model.progress.requiredFields} obaveznih polja</Text>
      </View>
      {model.sections.map((section) => section.visible ? (
        <View key={section.key} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.description ? <Text style={styles.muted}>{section.description}</Text> : null}
          {section.fields.map((field) => <FieldControl key={field.key} field={field} value={values[field.key]} disabled={busy || activeUpload !== null || field.disabled || !canSubmit} onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))} onCamera={() => void pickPhoto(field, 'CAMERA')} onGallery={() => void pickPhoto(field, 'GALLERY')} onDocument={() => void pickDocument(field)} canUpload={canUpload} uploading={activeUpload === field.key} />)}
        </View>
      ) : null)}

      {isInProgress && canComplete ? (
        <View style={styles.section}>
          {task.vehicleId ? <TextInput value={odometer} onChangeText={(value) => setOdometer(value.replace(/[^0-9]/gu, ''))} placeholder="Kilometraža (km), ako je potrebna" keyboardType="numeric" style={styles.input} /> : null}
          <TextInput value={comment} onChangeText={setComment} placeholder="Komentar uz završetak (opciono)" multiline maxLength={2000} style={[styles.input, styles.textarea]} />
        </View>
      ) : null}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {canSubmit ? <Pressable accessibilityRole="button" onPress={() => void submit(isOpen ? 'CLAIM' : 'COMPLETE')} disabled={busy || activeUpload !== null} style={({ pressed }) => [styles.submit, pressed && styles.pressed, (busy || activeUpload !== null) && styles.disabled]}><Text style={styles.submitText}>{busy ? 'Sačuvavam…' : submitLabel}</Text></Pressable> : null}
    </View>
  );
}

export function FieldControl({ field, value, disabled, onChange, onCamera, onGallery, onDocument, canUpload, uploading }: {
  field: RenderField;
  value: unknown;
  disabled: boolean;
  onChange(value: unknown): void;
  onCamera(): void;
  onGallery(): void;
  onDocument(): void;
  canUpload: boolean;
  uploading: boolean;
}) {
  const [loadedOptions, setLoadedOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const source = field.optionsSource;
      const isVehicle = field.type === 'REFERENCE_VEHICLE' || (source?.kind === 'QUERY' && source.queryId === 'ACTIVE_VEHICLES');
      const isDriver = field.type === 'REFERENCE_DRIVER' || (source?.kind === 'QUERY' && source.queryId === 'ACTIVE_DRIVERS');
      const isTaskType = source?.kind === 'QUERY' && source.queryId === 'OPEN_TASK_TYPES';
      const isList = source?.kind === 'LIST';
      const isWorkshopQuery = source?.kind === 'QUERY' && source.queryId === 'WORKSHOPS';
      const isTireSetQuery = source?.kind === 'QUERY' && source.queryId === 'TIRE_SETS_BY_VEHICLE';
      const entityType = typeof field.validation['entityType'] === 'string' ? field.validation['entityType'] : '';
      const isRecordReference = field.type === 'REFERENCE_RECORD' && entityType.length > 0;
      if (!isVehicle && !isDriver && !isTaskType && !isList && !isWorkshopQuery && !isTireSetQuery && !isRecordReference) { setLoadedOptions([]); return; }
      setLoadingOptions(true);
      try {
        let resolved: Array<{ value: string; label: string }> = [];
        if (isVehicle) {
          const result = await mobileApi.vehicles();
          resolved = result.items.filter((item) => item.status === 'ACTIVE').map((item) => ({ value: item.id, label: `${item.internalNo} · ${item.make} ${item.model}` }));
        } else if (isDriver) {
          const result = await mobileApi.drivers();
          resolved = result.items.filter((item) => item.status === 'ACTIVE').map((item) => ({ value: item.id, label: item.displayName || `${item.firstName} ${item.lastName}` }));
        } else if (isTaskType) {
          const result = await mobileApi.taskTypes();
          resolved = result.items.map((item) => ({ value: item.id, label: item.name }));
        } else if (source?.kind === 'LIST') {
          resolved = await mobileApi.formOptions(source.listCode);
        } else if (isWorkshopQuery) {
          resolved = await mobileApi.formOptions('WORKSHOP');
        } else if (source?.kind === 'QUERY' && source.queryId === 'TIRE_SETS_BY_VEHICLE') {
          const vehicleId = source.params?.['vehicleId'];
          if (typeof vehicleId === 'string') {
            const result = await mobileApi.tireSets();
            resolved = result.items.filter((item) => item.mountedVehicleId === vehicleId).map((item) => ({ value: item.id, label: `${item.code} · ${item.brand ?? ''} ${item.model ?? ''} ${item.size ?? ''}`.trim() }));
          }
        } else if (field.type === 'REFERENCE_RECORD' && typeof field.validation['entityType'] === 'string') {
          const records = await mobileApi.recordOptions(field.validation['entityType']);
          resolved = records.map((record) => ({ value: record.entityId, label: record.label }));
        }
        if (active) setLoadedOptions(resolved);
      } catch { if (active) setLoadedOptions([]); }
      finally { if (active) setLoadingOptions(false); }
    };
    void load();
    return () => { active = false; };
  }, [field.key, field.type, field.optionsSource]);
  if (field.widget === 'OUTPUT' || field.readOnly) {
    return <View style={styles.field}><Text style={styles.label}>{field.label}</Text><Text style={styles.output}>{field.value === null ? '—' : String(field.value)}</Text></View>;
  }
  if (field.widget === 'GROUP') return <Text style={styles.sectionTitle}>{field.label}</Text>;
  const valueText = fieldText({ ...field, value });
  const options = field.options ?? [];
  const reference = field.widget === 'REFERENCE';
  const renderedOptions = options.length ? options : loadedOptions;
  const multiple = field.widget === 'MULTI_SELECT';
  const selected = multiple ? stringArray(value) : [];
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{field.label}{field.required ? ' *' : ''}</Text>
      {field.helpText ? <Text style={styles.help}>{field.helpText}</Text> : null}
      {field.widget === 'BOOLEAN' ? (
        <Switch value={value === true} onValueChange={onChange} disabled={disabled} trackColor={{ true: colors.primary }} />
      ) : field.widget === 'SELECT' || multiple || reference ? (
        renderedOptions.length ? <View style={styles.options}>{renderedOptions.map((option) => {
          const recordRef = field.type === 'REFERENCE_RECORD';
          const currentEntityId = recordRef && typeof value === 'object' && value !== null && typeof (value as { entityId?: unknown }).entityId === 'string' ? (value as { entityId: string }).entityId : value;
          const active = multiple ? selected.includes(option.value) : currentEntityId === option.value;
          const nextValue = recordRef ? { entityType: field.validation['entityType'], entityId: option.value } : option.value;
          return <Pressable key={option.value} onPress={() => onChange(multiple ? (active ? selected.filter((item) => item !== option.value) : [...selected, option.value]) : active ? undefined : nextValue)} disabled={disabled || ('disabled' in option && option.disabled === true)} style={[styles.option, active && styles.optionActive]}><Text style={[styles.optionText, active && styles.optionTextActive]}>{option.label}</Text></Pressable>;
        })}</View> : <Text style={styles.help}>{loadingOptions ? 'Učitavanje izbora…' : reference ? field.type === 'REFERENCE_RECORD' ? 'Povezani zapisi nisu dostupni; provjerite entityType i dozvolu za pregled.' : 'Nema dostupnih zapisa ili nedostaje dozvola za pregled.' : field.optionsSourceKind === 'LIST' || (field.optionsSource?.kind === 'QUERY' && field.optionsSource.queryId === 'WORKSHOPS') ? 'Šifarnik je prazan ili nije dostupan.' : field.optionsSource?.kind === 'QUERY' && field.optionsSource.queryId === 'TIRE_SETS_BY_VEHICLE' ? 'Nema kompleta guma za vozilo. Podesite params.vehicleId i dozvolu tire:view.' : 'Ovaj QUERY izvor još nije podržan u mobilnom obrascu.'}</Text>
      ) : field.widget === 'PHOTO' || field.widget === 'FILE' ? (
        <View style={styles.uploadBox}>
          <Text style={styles.help}>Dodano fajlova: {stringArray(value).length}{uploading ? ' · Upload u toku…' : ''}</Text>
          {canUpload ? <View style={styles.options}>
            {field.widget === 'PHOTO' ? <>
              <Pressable disabled={disabled} onPress={onCamera} style={styles.option}><Text style={styles.optionText}>Kamera</Text></Pressable>
              <Pressable disabled={disabled} onPress={onGallery} style={styles.option}><Text style={styles.optionText}>Galerija</Text></Pressable>
            </> : <Pressable disabled={disabled} onPress={onDocument} style={styles.option}><Text style={styles.optionText}>Odaberi fajl</Text></Pressable>}
          </View> : <Text style={styles.help}>Za upload je potrebna dozvola attachment:upload.</Text>}
        </View>
      ) : (
        <TextInput
          value={valueText}
          onChangeText={(text) => {
            if (field.widget === 'NUMBER') {
              const parsed = text.trim() ? Number(text.replace(',', '.')) : undefined;
              onChange(parsed === undefined || !Number.isFinite(parsed) ? undefined : field.type === 'INTEGER' ? Math.trunc(parsed) : parsed);
            } else if (field.widget === 'MONEY') {
              const parsed = text.trim() ? Number(text.replace(',', '.')) : undefined;
              const currency = typeof field.validation['currency'] === 'string' ? field.validation['currency'] as string : 'BAM';
              onChange(parsed === undefined || !Number.isFinite(parsed) ? undefined : { amount: Math.round(parsed * 100), currency });
            } else onChange(text);
          }}
          placeholder={field.placeholder ?? undefined}
          keyboardType={field.widget === 'NUMBER' || field.widget === 'MONEY' || field.widget === 'CURRENCY' ? 'decimal-pad' : 'default'}
          multiline={field.widget === 'TEXTAREA'}
          editable={!disabled}
          style={[styles.input, field.widget === 'TEXTAREA' && styles.textarea]}
        />
      )}
      {field.errors.map((item, index) => <Text key={`${item.code}-${index}`} style={styles.error}>{item.message}</Text>)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 }, formHeading: { gap: 4 }, formTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' }, muted: { color: colors.muted, fontSize: 13, lineHeight: 19 }, section: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 }, sectionTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' }, field: { gap: 6 }, label: { color: colors.ink, fontSize: 14, fontWeight: '700' }, help: { color: colors.muted, fontSize: 12, lineHeight: 17 }, input: { minHeight: 46, borderColor: colors.border, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, fontSize: 15, backgroundColor: '#fff' }, textarea: { minHeight: 90, textAlignVertical: 'top' }, output: { color: colors.ink, fontSize: 15, backgroundColor: colors.background, padding: 12, borderRadius: 10 }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, option: { borderWidth: 1, borderColor: colors.border, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: '#fff' }, optionActive: { backgroundColor: '#E8F3F0', borderColor: colors.primary }, optionText: { color: colors.ink, fontSize: 13, fontWeight: '600' }, optionTextActive: { color: colors.primaryDark }, uploadBox: { gap: 8 }, submit: { minHeight: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: 12, marginBottom: 10 }, submitText: { color: '#fff', fontSize: 16, fontWeight: '800' }, pressed: { opacity: 0.82 }, disabled: { opacity: 0.55 }, error: { color: colors.danger, fontSize: 13, lineHeight: 19 }, state: { padding: 18, gap: 10, alignItems: 'center' },
});
