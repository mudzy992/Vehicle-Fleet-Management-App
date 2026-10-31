import { ActivityIndicator, Text, View } from 'react-native';
import type { RenderField, RenderModel } from '@vfm/form-renderer/render-model';
import { formatDate, statusLabel } from '@vfm/shared';
import { ChoiceRow } from '@/features/tasks/choice-row';
import { FieldControl } from '@/features/tasks/field-control';
import type { ActiveTaskForm, MobileTaskType, UserSummary, VehicleSummary } from '@/lib/api';
import { colors } from '@/lib/theme';
import { AppTextField } from '@/ui/text-field';

export function CreateTaskStepOne({
  taskTypes,
  selectedType,
  taskTypeId,
  vehicleId,
  vehicles,
  onSelectType,
  onSelectVehicle,
}: {
  taskTypes: MobileTaskType[];
  selectedType: MobileTaskType | null;
  taskTypeId: string;
  vehicleId: string;
  vehicles: VehicleSummary[];
  onSelectType(item: MobileTaskType): void;
  onSelectVehicle(id: string): void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>1. Vrsta i vozilo</Text>
      <Text style={styles.label}>Vrsta zadatka</Text>
      <View style={styles.choices}>
        {taskTypes.map((item) => (
          <ChoiceRow key={item.id} testID={`task-create-type-${item.code.toLowerCase()}`} active={item.id === taskTypeId} label={item.name} detail={item.description ?? item.code} onPress={() => onSelectType(item)} />
        ))}
      </View>
      {selectedType?.requiresVehicle ? (
        <>
          <Text style={styles.label}>Vozilo</Text>
          {vehicles.length ? (
            <View style={styles.choices}>
              {vehicles.map((item) => (
                <ChoiceRow key={item.id} testID={`task-create-vehicle-${item.internalNo.toLowerCase()}`} active={item.id === vehicleId} label={`${item.internalNo} · ${item.make} ${item.model}`} detail={item.plateNumber ?? 'Bez registarske oznake'} onPress={() => onSelectVehicle(item.id)} />
              ))}
            </View>
          ) : <Text style={styles.error}>Nema vozila za izbor ili nemate dozvolu vehicle:view.</Text>}
        </>
      ) : <Text style={styles.muted}>Ova vrsta zadatka ne zahtijeva vozilo.</Text>}
    </View>
  );
}

export function CreateTaskStepTwo({
  activeForm,
  formLoading,
  step2BlockReason,
  title,
  description,
  priority,
  dueDate,
  assignMode,
  canAssignDirect,
  canViewUsers,
  users,
  assigneeUserId,
  invitedUserIds,
  observerUserIds,
  onTitle,
  onDescription,
  onPriority,
  onDueDate,
  onAssignMode,
  onAssignee,
  onToggleInvited,
  onToggleObserver,
}: {
  activeForm: ActiveTaskForm | null;
  formLoading: boolean;
  step2BlockReason: 'form' | 'compatibility' | 'vehicle' | null;
  title: string;
  description: string;
  priority: string;
  dueDate: string;
  assignMode: 'OPEN_CLAIM' | 'ASSIGN_DIRECT' | 'BROADCAST';
  canAssignDirect: boolean;
  canViewUsers: boolean;
  users: UserSummary[];
  assigneeUserId: string;
  invitedUserIds: string[];
  observerUserIds: string[];
  onTitle(value: string): void;
  onDescription(value: string): void;
  onPriority(value: string): void;
  onDueDate(value: string): void;
  onAssignMode(value: 'OPEN_CLAIM' | 'ASSIGN_DIRECT' | 'BROADCAST'): void;
  onAssignee(id: string): void;
  onToggleInvited(id: string): void;
  onToggleObserver(id: string): void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>2. Detalji</Text>
      {activeForm ? <Text testID="task-create-active-form" style={styles.muted}>{activeForm.name} · v{activeForm.version}</Text> : null}
      {formLoading ? <Text testID="task-create-form-loading" style={styles.muted}>Učitavanje obrasca…</Text> : null}
      {activeForm?.mobileCompatible ? <Text testID="task-create-form-ready" style={styles.muted}>Obrazac je spreman za mobilno kreiranje.</Text> : null}
      {step2BlockReason === 'vehicle' ? <Text testID="task-create-step2-blocked-vehicle" style={styles.error}>Odaberite vozilo prije nastavka.</Text> : null}
      {activeForm && !activeForm.mobileCompatible ? <Text testID="task-create-form-incompatible" style={styles.error}>Objavljena forma nije označena kao kompatibilna s mobilnom aplikacijom.</Text> : null}
      {!step2BlockReason ? <Text testID="task-create-step2-ready" style={styles.muted}>Obrazac i vozilo su spremni.</Text> : null}
      <Text style={styles.label}>Naslov (opciono)</Text>
      <AppTextField testID="task-create-title" accessibilityLabel="Naslov zadatka" value={title} onChangeText={onTitle} placeholder="Automatski se predlaže iz vrste i vozila" maxLength={160} />
      <Text style={styles.label}>Opis (opciono)</Text>
      <AppTextField value={description} onChangeText={onDescription} placeholder="Dodatne upute" multiline maxLength={2000} style={styles.textarea} />
      <Text style={styles.label}>Prioritet</Text>
      <View style={styles.choices}>{(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((item) => <ChoiceRow key={item} active={priority === item} label={item === 'LOW' ? 'Nizak' : item === 'HIGH' ? 'Visok' : item === 'URGENT' ? 'Hitno' : 'Normalan'} onPress={() => onPriority(item)} />)}</View>
      <Text style={styles.label}>Rok (opciono, dd.MM.yyyy)</Text>
      <AppTextField value={dueDate} onChangeText={onDueDate} placeholder={formatDate(new Date())} keyboardType="numbers-and-punctuation" />
      <Text style={styles.label}>Način dodjele</Text>
      <View style={styles.choices}>
        {canAssignDirect ? <ChoiceRow active={assignMode === 'ASSIGN_DIRECT'} label={statusLabel('ASSIGN_DIRECT', 'taskAssignMode')} detail="Jedan izvršilac odmah." onPress={() => onAssignMode('ASSIGN_DIRECT')} /> : null}
        <ChoiceRow active={assignMode === 'BROADCAST'} label={statusLabel('BROADCAST', 'taskAssignMode')} detail="Svi s dozvolom za preuzimanje." onPress={() => onAssignMode('BROADCAST')} />
        {canViewUsers ? <ChoiceRow active={assignMode === 'OPEN_CLAIM'} label={statusLabel('OPEN_CLAIM', 'taskAssignMode')} detail="Samo odabrani korisnici." onPress={() => onAssignMode('OPEN_CLAIM')} /> : null}
      </View>
      {assignMode === 'ASSIGN_DIRECT' ? <><Text style={styles.label}>Izvršilac *</Text>{users.length ? <View style={styles.choices}>{users.map((item) => <ChoiceRow key={item.id} active={assigneeUserId === item.id} label={item.displayName ?? `${item.firstName} ${item.lastName}`} onPress={() => onAssignee(item.id)} />)}</View> : <Text style={styles.error}>Nema aktivnih korisnika za izbor.</Text>}</> : null}
      {assignMode === 'OPEN_CLAIM' && canViewUsers ? <><Text style={styles.label}>Pozvani korisnici *</Text><View style={styles.choices}>{users.map((item) => <ChoiceRow key={item.id} active={invitedUserIds.includes(item.id)} selectionRole="checkbox" label={item.displayName ?? `${item.firstName} ${item.lastName}`} onPress={() => onToggleInvited(item.id)} />)}</View></> : null}
      {canViewUsers ? <><Text style={styles.label}>Posmatrači (opciono)</Text><View style={styles.choices}>{users.filter((item) => item.id !== assigneeUserId && !invitedUserIds.includes(item.id)).map((item) => <ChoiceRow key={item.id} active={observerUserIds.includes(item.id)} selectionRole="checkbox" label={item.displayName ?? `${item.firstName} ${item.lastName}`} onPress={() => onToggleObserver(item.id)} />)}</View></> : null}
    </View>
  );
}

export function CreateTaskStepThree({
  formLoading,
  model,
  values,
  submitting,
  uploadingField,
  canUpload,
  error,
  onChange,
  onCamera,
  onGallery,
  onDocument,
}: {
  formLoading: boolean;
  model: RenderModel | null;
  values: Record<string, unknown>;
  submitting: boolean;
  uploadingField: string | null;
  canUpload: boolean;
  error: string | null;
  onChange(key: string, value: unknown): void;
  onCamera(field: RenderField): void;
  onGallery(field: RenderField): void;
  onDocument(field: RenderField): void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>3. Obrazac</Text>
      {formLoading ? <ActivityIndicator color={colors.primary} /> : model ? model.sections.map((section) => section.visible ? (
        <View key={section.key} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.fields.map((field) => (
            <FieldControl key={field.key} field={field} value={values[field.key]} disabled={submitting || uploadingField !== null || field.disabled} uploadLocked={submitting || uploadingField !== null} onChange={(value) => onChange(field.key, value)} onCamera={() => onCamera(field)} onGallery={() => onGallery(field)} onDocument={() => onDocument(field)} canUpload={canUpload} uploading={uploadingField === field.key} />
          ))}
        </View>
      ) : null) : <Text accessibilityRole="alert" style={styles.error}>{error ?? 'Obrazac se ne može prikazati.'}</Text>}
    </View>
  );
}

const styles = {
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  sectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' as const },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '700' as const, marginTop: 4 },
  textarea: { minHeight: 86, textAlignVertical: 'top' as const },
  choices: { gap: 8 },
  section: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, gap: 12 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
};
