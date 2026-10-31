import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { buildRenderModel, collectSubmitValues, type RenderField, type RenderModel } from '@vfm/form-renderer/render-model';
import { parseDefinition } from '@vfm/form-engine/definition';
import { toLocalDateString } from '@vfm/shared';
import { ApiError, mobileApi, toUserMessage, type TaskDetail } from '@/lib/api';
import { FieldControl } from '@/features/tasks/field-control';
import { TaskOrderReadonly } from '@/features/tasks/task-order-readonly';
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
  const isOpen = task.status === 'OPEN';
  const isInProgress = task.status === 'IN_PROGRESS';
  const realizationId = task.realizationFormSchemaVersionId ?? task.formSchemaVersionId;
  const realizationSchemaId = task.realizationFormSchemaId ?? task.formSchemaId;
  const [snapshot, setSnapshot] = useState<{ definition: unknown; version: number } | null>(null);
  const [loading, setLoading] = useState(isInProgress);
  const [values, setValues] = useState<Record<string, unknown>>(task.realizationFormData ?? {});
  const [busy, setBusy] = useState(false);
  const [activeUpload, setActiveUpload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Array<{ key: string; code: string; message: string }>>([]);
  const [comment, setComment] = useState('');
  const [odometer, setOdometer] = useState('');

  useEffect(() => {
    if (!isInProgress) return;
    let active = true;
    setLoading(true);
    mobileApi
      .formVersion({ formSchemaId: realizationSchemaId, formSchemaVersionId: realizationId })
      .then((result) => {
        if (active) setSnapshot({ definition: result.definition, version: result.version });
      })
      .catch((cause: unknown) => {
        if (active) setError(toUserMessage(cause, 'Forma realizacije se nije mogla učitati.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isInProgress, realizationSchemaId, realizationId]);

  const parsed = useMemo(() => (snapshot ? parseDefinition(snapshot.definition) : null), [snapshot]);
  const model = useMemo<RenderModel | null>(() => {
    if (!parsed?.ok || !snapshot) return null;
    return buildRenderModel({
      definition: parsed.definition,
      values,
      errors: fieldErrors,
      today: toLocalDateString(new Date()),
      version: snapshot.version,
      formSchemaVersionId: realizationId,
    });
  }, [parsed, snapshot, values, fieldErrors, realizationId]);

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

  const handleClaim = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onTaskUpdated(await mobileApi.claimTask(task.id));
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'TASK_ALREADY_CLAIMED') {
        Alert.alert('Zadatak je preuzet', cause.message, [
          { text: 'Nazad na listu', onPress: onBack },
          { text: 'Osvježi', onPress: () => { void mobileApi.task(task.id).then(onTaskUpdated); } },
        ]);
        return;
      }
      setError(cause instanceof ApiError ? toUserMessage(cause, 'Zadatak nije preuzet.') : 'Preuzimanje zadatka nije uspjelo.');
    } finally {
      setBusy(false);
    }
  };

  const handleComplete = async () => {
    if (!model || busy) return;
    setBusy(true);
    setError(null);
    setFieldErrors([]);
    try {
      const updated = await mobileApi.completeTask(task.id, task.version, collectSubmitValues(model), {
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(odometer.trim() ? { odometerKm: Number(odometer) } : {}),
      });
      setValues(updated.realizationFormData ?? {});
      onTaskUpdated(updated);
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(toUserMessage(cause, 'Zadatak nije moguće završiti.'));
        setFieldErrors((cause.details ?? []).flatMap((detail) => {
          const path = detail.path.join('.');
          const key = path.startsWith('formData.') ? path.slice('formData.'.length)
            : path.startsWith('realizationFormData.') ? path.slice('realizationFormData.'.length) : '';
          return key ? [{ key, code: cause.code, message: detail.message }] : [];
        }));
      } else setError('Završetak zadatka nije uspio.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <TaskOrderReadonly task={task} />
      {isOpen && canClaim ? (
        <Pressable testID="task-claim-submit" accessibilityRole="button" onPress={() => void handleClaim()} disabled={busy} style={({ pressed }) => [styles.submit, pressed && styles.pressed, busy && styles.disabled]}>
          <Text style={[styles.submitText, busy && styles.submitMuted]}>{busy ? 'Preuzimam…' : 'Preuzmi zadatak'}</Text>
        </Pressable>
      ) : null}
      {isInProgress ? (
        loading ? (
          <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={styles.muted}>Učitavanje realizacije…</Text></View>
        ) : model ? (
          <>
            <Text style={styles.formTitle}>Realizacija</Text>
            {model.sections.map((section) => section.visible ? (
              <View key={section.key} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                {section.fields.map((field) => (
                  <FieldControl
                    key={field.key}
                    field={field}
                    value={values[field.key]}
                    disabled={busy || activeUpload !== null || field.disabled || !canComplete}
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
            {canComplete ? (
              <View style={styles.section}>
                {task.vehicleId ? <AppTextField value={odometer} onChangeText={(value) => setOdometer(value.replace(/[^0-9]/gu, ''))} placeholder="Kilometraža (km), ako je potrebna" keyboardType="numeric" /> : null}
                <AppTextField value={comment} onChangeText={setComment} placeholder="Komentar uz završetak (opciono)" multiline maxLength={2000} style={styles.textarea} />
              </View>
            ) : null}
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            {canComplete ? (
              <Pressable testID="task-complete-submit" accessibilityRole="button" onPress={() => void handleComplete()} disabled={busy || activeUpload !== null} style={({ pressed }) => [styles.submit, pressed && styles.pressed, (busy || activeUpload !== null) && styles.disabled]}>
                <Text style={[styles.submitText, (busy || activeUpload !== null) && styles.submitMuted]}>{busy ? 'Sačuvavam…' : 'Završi zadatak'}</Text>
              </Pressable>
            ) : null}
          </>
        ) : <Text accessibilityRole="alert" style={styles.error}>{error ?? 'Definicija realizacije nije ispravna.'}</Text>
      ) : error && isOpen ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
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
