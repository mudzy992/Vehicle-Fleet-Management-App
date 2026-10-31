import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { type RenderField } from '@vfm/form-renderer/render-model';
import { PhotoActions } from '@/features/tasks/photo-actions';
import { ApiError, mobileApi, toUserMessage } from '@/lib/api';
import { t } from '@/lib/i18n';
import { colors, controlMinHeight, radius, space, type } from '@/lib/theme';
import { AppTextField } from '@/ui/text-field';

function moneyText(value: unknown): string {
  if (typeof value !== 'object' || value === null) return '';
  const amount = (value as { amount?: unknown }).amount;
  return typeof amount === 'number' ? (amount / 100).toFixed(2) : '';
}

function fieldText(field: RenderField, value: unknown): string {
  if (field.widget === 'MONEY') return moneyText(value);
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function FieldControl({ field, value, disabled, uploadLocked = false, onChange, onCamera, onGallery, onDocument, canUpload, uploading }: {
  field: RenderField;
  value: unknown;
  disabled: boolean;
  uploadLocked?: boolean;
  onChange(value: unknown): void;
  onCamera(): void;
  onGallery(): void;
  onDocument(): void;
  canUpload: boolean;
  uploading: boolean;
}) {
  const [loadedOptions, setLoadedOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionError, setOptionError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const source = field.optionsSource;
      const entityType = typeof field.validation['entityType'] === 'string' ? field.validation['entityType'] : '';
      const isVehicle = field.type === 'REFERENCE_VEHICLE' || (source?.kind === 'QUERY' && source.queryId === 'ACTIVE_VEHICLES');
      const isDriver = field.type === 'REFERENCE_DRIVER' || (source?.kind === 'QUERY' && source.queryId === 'ACTIVE_DRIVERS');
      const isTaskType = source?.kind === 'QUERY' && source.queryId === 'OPEN_TASK_TYPES';
      const isList = source?.kind === 'LIST';
      const isWorkshopQuery = source?.kind === 'QUERY' && source.queryId === 'WORKSHOPS';
      const isTireSetQuery = source?.kind === 'QUERY' && source.queryId === 'TIRE_SETS_BY_VEHICLE';
      const isRecordReference = field.type === 'REFERENCE_RECORD' && entityType.length > 0;
      if (!isVehicle && !isDriver && !isTaskType && !isList && !isWorkshopQuery && !isTireSetQuery && !isRecordReference) {
        setLoadedOptions([]);
        return;
      }
      if (entityType === 'VEHICLE_HANDOVER' || entityType === 'OTHER') {
        setOptionError(t('recordTypeUnsupported'));
        setLoadedOptions([]);
        return;
      }
      if (isTireSetQuery && typeof source?.params?.['vehicleId'] !== 'string') {
        setOptionError(t('tireSetsNeedVehicle'));
        setLoadedOptions([]);
        return;
      }
      setLoadingOptions(true);
      setOptionError(null);
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
        } else if (isTireSetQuery && typeof source.params?.['vehicleId'] === 'string') {
          const result = await mobileApi.tireSets();
          resolved = result.items.filter((item) => item.mountedVehicleId === source.params?.['vehicleId']).map((item) => ({ value: item.id, label: `${item.code} · ${item.brand ?? ''} ${item.model ?? ''} ${item.size ?? ''}`.trim() }));
        } else if (isRecordReference) {
          const records = await mobileApi.recordOptions(entityType);
          resolved = records.map((record) => ({ value: record.entityId, label: record.label }));
        }
        if (active) setLoadedOptions(resolved);
      } catch (cause) {
        if (active) {
          setLoadedOptions([]);
          setOptionError(cause instanceof ApiError && cause.code === 'UNSUPPORTED_REFERENCE' ? t('recordTypeUnsupported') : toUserMessage(cause, 'Izbor nije dostupan.'));
        }
      } finally {
        if (active) setLoadingOptions(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [field.key, field.type, field.optionsSource]);
  if (field.widget === 'OUTPUT' || field.readOnly) {
    return <View style={styles.field}><Text style={styles.label}>{field.label}</Text><Text style={styles.output}>{field.value === null ? '—' : String(field.value)}</Text></View>;
  }
  if (field.widget === 'GROUP') return <Text style={styles.sectionTitle}>{field.label}</Text>;
  const options = field.options ?? [];
  const reference = field.widget === 'REFERENCE';
  const renderedOptions = options.length ? options : loadedOptions;
  const multiple = field.widget === 'MULTI_SELECT';
  const selected = multiple ? stringArray(value) : [];
  return (
    <View style={styles.field}>
      <Text testID={`task-form-field-${field.key}`} style={styles.label}>{field.label}{field.required ? ' *' : ''}</Text>
      {field.helpText ? <Text style={styles.help}>{field.helpText}</Text> : null}
      {field.widget === 'BOOLEAN' ? (
        <Switch
          value={value === true}
          onValueChange={onChange}
          disabled={disabled}
          trackColor={{ false: colors.surfaceMuted, true: colors.primary }}
          thumbColor={value === true ? colors.primaryFg : colors.ink}
          ios_backgroundColor={colors.surfaceMuted}
        />
      ) : field.widget === 'SELECT' || multiple || reference ? (
        renderedOptions.length ? <View style={styles.options}>{renderedOptions.map((option) => {
          const recordRef = field.type === 'REFERENCE_RECORD';
          const currentEntityId = recordRef && typeof value === 'object' && value !== null && typeof (value as { entityId?: unknown }).entityId === 'string' ? (value as { entityId: string }).entityId : value;
          const active = multiple ? selected.includes(option.value) : currentEntityId === option.value;
          const nextValue = recordRef ? { entityType: field.validation['entityType'], entityId: option.value } : option.value;
          return <Pressable key={option.value} testID={`task-form-option-${field.key}-${option.value}`} accessibilityRole={multiple ? 'checkbox' : 'radio'} accessibilityState={{ selected: active }} onPress={() => onChange(multiple ? (active ? selected.filter((item) => item !== option.value) : [...selected, option.value]) : active ? undefined : nextValue)} disabled={disabled || ('disabled' in option && option.disabled === true)} style={[styles.option, active && styles.optionActive]}><Text style={[styles.optionText, active && styles.optionTextActive]}>{option.label}</Text></Pressable>;
        })}</View> : <Text style={styles.help}>{loadingOptions ? 'Učitavanje izbora…' : optionError ?? (reference ? 'Nema dostupnih zapisa ili nedostaje dozvola za pregled.' : 'Šifarnik je prazan ili nije dostupan.')}</Text>
      ) : field.widget === 'PHOTO' || field.widget === 'FILE' ? (
        canUpload ? (
          <PhotoActions
            widget={field.widget}
            locked={uploadLocked || field.disabled}
            uploading={uploading}
            count={stringArray(value).length}
            required={field.required}
            onCamera={onCamera}
            onGallery={onGallery}
            onDocument={onDocument}
          />
        ) : <Text style={styles.help}>Za upload je potrebna dozvola attachment:upload.</Text>
      ) : (
        <AppTextField
          value={fieldText(field, value)}
          onChangeText={(text) => {
            if (field.widget === 'NUMBER') {
              const parsed = text.trim() ? Number(text.replace(',', '.')) : undefined;
              onChange(parsed === undefined || !Number.isFinite(parsed) ? undefined : field.type === 'INTEGER' ? Math.trunc(parsed) : parsed);
            } else if (field.widget === 'MONEY') {
              const parsed = text.trim() ? Number(text.replace(',', '.')) : undefined;
              const currency = typeof field.validation['currency'] === 'string' ? field.validation['currency'] : 'BAM';
              onChange(parsed === undefined || !Number.isFinite(parsed) ? undefined : { amount: Math.round(parsed * 100), currency });
            } else onChange(text);
          }}
          placeholder={field.placeholder ?? undefined}
          keyboardType={field.widget === 'NUMBER' || field.widget === 'MONEY' || field.widget === 'CURRENCY' ? 'decimal-pad' : 'default'}
          multiline={field.widget === 'TEXTAREA'}
          editable={!disabled}
          style={field.widget === 'TEXTAREA' ? styles.textarea : undefined}
        />
      )}
      {optionError && renderedOptions.length === 0 ? <Text style={styles.error}>{optionError}</Text> : null}
      {field.errors.map((item, index) => <Text key={`${item.code}-${index}`} style={styles.error}>{item.message}</Text>)}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[2] },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  help: { color: colors.muted, ...type.sm, lineHeight: 20 },
  textarea: { minHeight: 90, textAlignVertical: 'top' },
  output: { color: colors.ink, fontSize: 15, backgroundColor: colors.background, padding: space[3], borderRadius: radius.md },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  option: { minHeight: controlMinHeight, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: space[3], paddingVertical: 9, backgroundColor: colors.surface, justifyContent: 'center' },
  optionActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  optionText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  optionTextActive: { color: colors.ink },
  error: { color: colors.danger, ...type.sm, lineHeight: 19 },
  sectionTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
});
