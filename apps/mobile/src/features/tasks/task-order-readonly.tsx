import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { buildRenderModel, formatFieldValue, type RenderModel } from '@vfm/form-renderer/render-model';
import { parseDefinition } from '@vfm/form-engine/definition';
import { toLocalDateString } from '@vfm/shared';
import { mobileApi, toUserMessage, type TaskDetail } from '@/lib/api';
import { colors, radius, space, type } from '@/lib/theme';

export function TaskOrderReadonly({ task }: { task: TaskDetail }) {
  const [snapshot, setSnapshot] = useState<{ definition: unknown; version: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const values = task.orderFormData ?? task.formData ?? {};

  useEffect(() => {
    let active = true;
    setLoading(true);
    mobileApi
      .formVersion(task)
      .then((result) => {
        if (active) setSnapshot({ definition: result.definition, version: result.version });
      })
      .catch((cause: unknown) => {
        if (active) setError(toUserMessage(cause, 'Nalog se nije mogao učitati.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [task.formSchemaId, task.formSchemaVersionId]);

  const parsed = useMemo(() => (snapshot ? parseDefinition(snapshot.definition) : null), [snapshot]);
  const model = useMemo<RenderModel | null>(() => {
    if (!parsed?.ok || !snapshot) return null;
    return buildRenderModel({
      definition: parsed.definition,
      values,
      errors: [],
      today: toLocalDateString(new Date()),
      version: snapshot.version,
      formSchemaVersionId: task.formSchemaVersionId,
    });
  }, [parsed, snapshot, values, task.formSchemaVersionId]);

  if (loading) {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.muted}>Učitavanje naloga…</Text>
      </View>
    );
  }
  if (error) return <Text accessibilityRole="alert" style={styles.error}>{error}</Text>;
  if (!model) return <Text style={styles.muted}>Nalog nema polja za prikaz.</Text>;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Nalog</Text>
      <Text style={styles.muted}>Snapshot obrasca v{snapshot?.version} · samo pregled</Text>
      {model.sections.map((section) =>
        section.visible ? (
          <View key={section.key} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.fields.map((field) => (
              <View key={field.key} style={styles.field}>
                <Text style={styles.label}>{field.label}</Text>
                <Text style={styles.value}>{formatFieldValue(field)}</Text>
              </View>
            ))}
          </View>
        ) : null,
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  title: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  muted: { color: colors.muted, ...type.sm, lineHeight: 20 },
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space[3],
    gap: space[3],
  },
  sectionTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  field: { gap: 4 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  value: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  error: { color: colors.danger, ...type.sm, lineHeight: 19 },
  state: { padding: 18, gap: 10, alignItems: 'center' },
});
