import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { buildRenderModel, collectSubmitValues, type RenderField, type RenderModel } from '@vfm/form-renderer/render-model';
import { parseDefinition } from '@vfm/form-engine/definition';
import { toLocalDateString } from '@vfm/shared';
import { ApiError, mobileApi, toUserMessage, type TaskDetail } from '@/lib/api';
import { FieldControl } from '@/features/tasks/field-control';
import { pickDocument, pickPhoto, uploadFiles } from '@/features/tasks/upload-picked';
import { colors, radius, space, stickyCtaHeight, type } from '@/lib/theme';
import { AppTextField } from '@/ui/text-field';

interface Props {
  task: TaskDetail;
  canClaim: boolean;
  canComplete: boolean;
  canUpload: boolean;
  onTaskUpdated(task: TaskDetail): void;
  onBack(): void;
}

export function DynamicTaskForm({ task, canClaim, canComplete, canUpload, onTaskUpdated, onBack }: Props) {
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
      if (active) setError(toUserMessage(cause, 'Snapshot forme se nije mogao učitati.'));
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
      today: toLocalDateString(new Date()),
      version: snapshot.version,
      formSchemaVersionId: task.formSchemaVersionId,
    });
  }, [parsed, snapshot, values, fieldErrors, task.formSchemaVersionId]);

  const handleUpload = async (field: RenderField, source: 'CAMERA' | 'GALLERY' | 'FILE') => {
    try {
      const files = source === 'FILE' ? await pickDocument(field) : await pickPhoto(field, source);
      setActiveUpload(field.key);
      await uploadFiles({
        field,
        files,
        existing: values[field.key],
        canUpload,
        onValues: (ids) => setValues((current) => ({ ...current, [field.key]: ids })),
        onError: setError,
      });
    } catch (cause) {
      setError(toUserMessage(cause, cause instanceof Error ? cause.message : 'Fajl nije moguće otvoriti.'));
    } finally {
      setActiveUpload(null);
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
      if (cause instanceof ApiError && cause.code === 'TASK_ALREADY_CLAIMED') {
        Alert.alert('Zadatak je preuzet', cause.message, [
          { text: 'Nazad na listu', onPress: onBack },
          { text: 'Osvježi', onPress: () => { void mobileApi.task(task.id).then(onTaskUpdated); } },
        ]);
        return;
      }
      if (cause instanceof ApiError) {
        setError(toUserMessage(cause, 'Zadatak nije moguće ažurirati.'));
        setFieldErrors((cause.details ?? []).flatMap((detail) => {
          const path = detail.path.join('.');
          return path.startsWith('formData.') ? [{ key: path.slice('formData.'.length), code: cause.code, message: detail.message }] : [];
        }));
      } else setError(action === 'CLAIM' ? 'Preuzimanje zadatka nije uspjelo.' : 'Završetak zadatka nije uspio.');
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
          {section.fields.map((field) => (
            <FieldControl
              key={field.key}
              field={field}
              value={values[field.key]}
              disabled={busy || activeUpload !== null || field.disabled || !canSubmit}
              uploadLocked={busy || activeUpload !== null || field.disabled}
              onChange={(next) => setValues((current) => ({ ...current, [field.key]: next }))}
              onCamera={() => void handleUpload(field, 'CAMERA')}
              onGallery={() => void handleUpload(field, 'GALLERY')}
              onDocument={() => void handleUpload(field, 'FILE')}
              canUpload={canUpload}
              uploading={activeUpload === field.key}
            />
          ))}
        </View>
      ) : null)}
      {isInProgress && canComplete ? (
        <View style={styles.section}>
          {task.vehicleId ? <AppTextField value={odometer} onChangeText={(value) => setOdometer(value.replace(/[^0-9]/gu, ''))} placeholder="Kilometraža (km), ako je potrebna" keyboardType="numeric" /> : null}
          <AppTextField value={comment} onChangeText={setComment} placeholder="Komentar uz završetak (opciono)" multiline maxLength={2000} style={styles.textarea} />
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {canSubmit ? (
        <Pressable testID={isOpen ? 'task-claim-submit' : 'task-complete-submit'} accessibilityRole="button" onPress={() => void submit(isOpen ? 'CLAIM' : 'COMPLETE')} disabled={busy || activeUpload !== null} style={({ pressed }) => [styles.submit, pressed && styles.pressed, (busy || activeUpload !== null) && styles.disabled]}>
          <Text style={[styles.submitText, (busy || activeUpload !== null) && styles.submitMuted]}>{busy ? 'Sačuvavam…' : submitLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  formHeading: { gap: 4 },
  formTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  muted: { color: colors.muted, ...type.sm, lineHeight: 20 },
  section: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space[3], gap: space[3] },
  sectionTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  submit: { minHeight: stickyCtaHeight, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: radius.lg, marginBottom: 10 },
  submitText: { color: colors.primaryFg, fontSize: 16, fontWeight: '800' },
  pressed: { opacity: 0.82 },
  disabled: { backgroundColor: colors.surfaceMuted },
  submitMuted: { color: colors.muted },
  error: { color: colors.danger, ...type.sm, lineHeight: 19 },
  state: { padding: 18, gap: 10, alignItems: 'center' },
});
