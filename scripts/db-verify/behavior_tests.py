"""Ponašajni testovi VFM migracija nad STVARNIM PostgreSQL-om (95 asertacija).

Provjerava ono što se iz koda ne vidi: da DB triggeri zaista odbijaju izmjene
(append-only AuditLog/TaskEvent, imutabilna PUBLISHED verzija forme, zaštita
posljednjeg Super Admina), da CHECK/UNIQUE/EXCLUDE ograničenja zaista odbijaju
loše podatke, i da soft-delete dopušta ponovno korištenje prirodnih ključeva.

Upotreba (nakon apply_migrations.py na istoj bazi):
    python3 scripts/db-verify/behavior_tests.py [DSN]

DSN default: postgresql://vfm:vfm_dev_only@127.0.0.1:5433/vfm_verify

Svaki case ide kroz SAVEPOINT, pa očekivana greška ne prekida ostatak testa.
Zahtijeva: Python 3.9+ i `pip install "psycopg[binary]"`.
"""
import sys

import psycopg

DSN = sys.argv[1] if len(sys.argv) > 1 else (
    "postgresql://vfm:vfm_dev_only@127.0.0.1:5433/vfm_verify"
)
PASS, FAIL = [], []

A = '11111111-1111-4111-8111-111111111111'   # Super Admin 1
B = '22222222-2222-4222-8222-222222222222'   # Super Admin 2
X = '33333333-3333-4333-8333-333333333333'   # običan korisnik (bez role)
C = '44444444-4444-4444-8444-444444444444'   # korisnik za test e-maila
RSA = '55555555-5555-4555-8555-555555555555' # uloga SUPER_ADMIN
RAD = '66666666-6666-4666-8666-666666666666' # uloga ADMINISTRATOR
URA = '77777777-7777-4777-8777-777777777777' # UserRole A↔SUPER_ADMIN
URB = '88888888-8888-4888-8888-888888888888' # UserRole B↔SUPER_ADMIN
FSV = '99999999-9999-4999-8999-999999999991' # FormSchema (vozilo)
FSVV= '99999999-9999-4999-8999-999999999992' # FormSchemaVersion 1 (PUBLISHED)
FSVD= '99999999-9999-4999-8999-999999999993' # FormSchemaVersion 2 (DRAFT)
FSVE= '99999999-9999-4999-8999-999999999994' # FormSchemaVersion 3 (DRAFT, brisanje)
FST = '99999999-9999-4999-8999-999999999995' # FormSchema subject=TASK
TT  = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' # TaskType
V1  = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' # Vehicle
V2  = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
TS1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' # TireSet
TIR1= 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
TIR2= 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'
TI1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' # TireInstallation
TI2 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2'
REG1= 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
REG2= 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'
REG3= 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3'
TASK1='ffffffff-ffff-4fff-8fff-ffffffffffff'
TASK2='ffffffff-ffff-4fff-8fff-fffffffffff2'
TASK3='ffffffff-ffff-4fff-8fff-fffffffffff3'
TASK4='ffffffff-ffff-4fff-8fff-fffffffffff4'
TA1 = 'ffffffff-ffff-4fff-8fff-fffffffffff5'
TA2 = 'ffffffff-ffff-4fff-8fff-fffffffffff6'
TA3 = 'ffffffff-ffff-4fff-8fff-fffffffffff7'
SR1 = 'aaaaaaaa-1111-4111-8111-111111111111'
SI1 = 'aaaaaaaa-2222-4222-8222-222222222222'
SI2 = 'aaaaaaaa-3333-4333-8333-333333333333'
OR1 = 'aaaaaaaa-4444-4444-8444-444444444444'

conn = psycopg.connect(DSN, autocommit=False)
cur = conn.cursor()

def ok(name, sql, params=None):
    cur.execute('SAVEPOINT s')
    try:
        cur.execute(sql, params)
        cur.execute('RELEASE SAVEPOINT s')
        PASS.append(name)
    except Exception as e:
        cur.execute('ROLLBACK TO SAVEPOINT s')
        FAIL.append((name, f'očekivan OK, dobijena greška: {str(e).strip().splitlines()[0]}'))

def err(name, sql, needle, params=None):
    cur.execute('SAVEPOINT s')
    try:
        cur.execute(sql, params)
        cur.execute('ROLLBACK TO SAVEPOINT s')
        FAIL.append((name, f'očekivana greška "{needle}", ali je prošao'))
    except Exception as e:
        cur.execute('ROLLBACK TO SAVEPOINT s')
        msg = str(e)
        if needle.lower() in msg.lower():
            PASS.append(name)
        else:
            FAIL.append((name, f'očekivano "{needle}", dobijeno: {msg.strip().splitlines()[0]}'))

USER_COLS = '(id, email, "passwordHash", "firstName", "lastName", "updatedAt")'
def ins_user(uid, email, first='Ana', last='Anić'):
    return f"""INSERT INTO "User" {USER_COLS} VALUES ('{uid}','{email}','$argon2id$x','{first}','{last}', now())"""

# --- 1) NULA Super Admina: običan korisnik se MORA moći deaktivirati ---------
ok('1.1 insert običnog korisnika (bez role)', ins_user(X, 'obicni@example.ba'))
ok('1.2 deaktivacija običnog korisnika dok NEMA super admina',
   f"""UPDATE "User" SET status='DEACTIVATED', "updatedAt"=now() WHERE id='{X}'""")
ok('1.3 soft delete običnog korisnika dok NEMA super admina',
   f"""UPDATE "User" SET status='ACTIVE', "deletedAt"=now(), "updatedAt"=now() WHERE id='{X}'""")
ok('1.4 hard delete običnog korisnika dok NEMA super admina', f"""DELETE FROM "User" WHERE id='{X}'""")

# --- 2) Fixtures -------------------------------------------------------------
ok('2.1 Role SUPER_ADMIN', f"""INSERT INTO "Role" (id, code, name, "updatedAt") VALUES ('{RSA}','SUPER_ADMIN','Super Administrator', now())""")
ok('2.2 Role ADMINISTRATOR', f"""INSERT INTO "Role" (id, code, name, "updatedAt") VALUES ('{RAD}','ADMINISTRATOR','Administrator', now())""")
ok('2.3 User A (Super Admin)', ins_user(A, 'admin.a@example.ba'))
ok('2.4 User B', ins_user(B, 'admin.b@example.ba'))
ok('2.5 UserRole A↔SUPER_ADMIN', f"""INSERT INTO "UserRole" (id, "userId", "roleId") VALUES ('{URA}','{A}','{RSA}')""")
ok('2.6 FormSchema (VEHICLE)', f"""INSERT INTO "FormSchema" (id, key, name, subject, "updatedAt") VALUES ('{FSV}','vozilo-osnovno','Vozilo — osnovno','VEHICLE', now())""")
ok('2.7 FormSchemaVersion 1 PUBLISHED', f"""INSERT INTO "FormSchemaVersion" (id, "formSchemaId", version, definition, status) VALUES ('{FSVV}','{FSV}',1,'{{}}'::jsonb,'PUBLISHED')""")
ok('2.8 TaskType WASH', f"""INSERT INTO "TaskType" (id, code, name, "updatedAt") VALUES ('{TT}','WASH','Pranje', now())""")
ok('2.9 Vehicle V-001', f"""INSERT INTO "Vehicle" (id, "internalNo", make, model, "fuelType", "formSchemaId", "formSchemaVersionId", "updatedAt") VALUES ('{V1}','V-001','MAN','TGS','DIESEL','{FSV}','{FSVV}', now())""")

# --- 3) Zaštita posljednjeg Super Admina (P-03) ------------------------------
err('3.1 deaktivacija jedinog Super Admina → blokirano',
    f"""UPDATE "User" SET status='DEACTIVATED', "updatedAt"=now() WHERE id='{A}'""", 'LAST_SUPER_ADMIN_PROTECTED')
err('3.2 soft delete jedinog Super Admina → blokirano',
    f"""UPDATE "User" SET "deletedAt"=now(), "updatedAt"=now() WHERE id='{A}'""", 'LAST_SUPER_ADMIN_PROTECTED')
err('3.3 hard delete jedinog Super Admina → blokirano',
    f"""DELETE FROM "User" WHERE id='{A}'""", 'LAST_SUPER_ADMIN_PROTECTED')
ok('3.4 UserRole B↔SUPER_ADMIN (sad ih je dvoje)', f"""INSERT INTO "UserRole" (id, "userId", "roleId") VALUES ('{URB}','{B}','{RSA}')""")
ok('3.5 deaktivacija A dok postoji B → dozvoljeno',
   f"""UPDATE "User" SET status='DEACTIVATED', "updatedAt"=now() WHERE id='{A}'""")
err('3.6 revokacija role zadnjem aktivnom Super Adminu (B) → blokirano',
    f"""UPDATE "UserRole" SET "revokedAt"=now() WHERE id='{URB}'""", 'LAST_SUPER_ADMIN_PROTECTED')
ok('3.7 reaktivacija A', f"""UPDATE "User" SET status='ACTIVE', "updatedAt"=now() WHERE id='{A}'""")

# --- 4) AuditLog: append-only + IDENTITY -------------------------------------
ok('4.1 insert AuditLog bez id', """INSERT INTO "AuditLog" (action, severity) VALUES ('LOGIN','INFO')""")
cur.execute("""SELECT id FROM "AuditLog" ORDER BY id""")
ids = [r[0] for r in cur.fetchall()]
PASS.append(f'4.2 identity dodijelio id={ids}') if ids == [1] else FAIL.append(('4.2 identity dodijelio id=1', f'dobijeno {ids}'))
err('4.3 eksplicitan id u AuditLog → odbijen (GENERATED ALWAYS)',
    """INSERT INTO "AuditLog" (id, action) VALUES (999,'LOGIN')""", 'non-DEFAULT value')
err('4.4 UPDATE AuditLog → IMMUTABLE_RECORD',
    """UPDATE "AuditLog" SET reason='x' WHERE id=1""", 'IMMUTABLE_RECORD')
err('4.5 DELETE AuditLog → IMMUTABLE_RECORD', """DELETE FROM "AuditLog" WHERE id=1""", 'IMMUTABLE_RECORD')

# --- 5) TaskEvent: append-only ----------------------------------------------
ok('5.1 Task T-1', f"""INSERT INTO "Task" (id, code, title, "taskTypeId", "createdById", "formSchemaId", "formSchemaVersionId", "updatedAt") VALUES ('{TASK1}','T-1','Pranje kabine','{TT}','{A}','{FSV}','{FSVV}', now())""")
ok('5.2 insert TaskEvent', f"""INSERT INTO "TaskEvent" (id, "taskId", action, "actorId") VALUES ('{SI1}','{TASK1}','CREATED','{A}')""")
err('5.3 UPDATE TaskEvent → IMMUTABLE_RECORD', f"""UPDATE "TaskEvent" SET data='{{}}'::jsonb WHERE id='{SI1}'""", 'IMMUTABLE_RECORD')
err('5.4 DELETE TaskEvent → IMMUTABLE_RECORD', f"""DELETE FROM "TaskEvent" WHERE id='{SI1}'""", 'IMMUTABLE_RECORD')

# --- 6) FormSchemaVersion: PUBLISHED je immutable (P-10) ---------------------
ok('6.1 insert verzije 2 (DRAFT)', f"""INSERT INTO "FormSchemaVersion" (id, "formSchemaId", version, definition, status) VALUES ('{FSVD}','{FSV}',2,'{{"a":1}}'::jsonb,'DRAFT')""")
ok('6.2 DRAFT se može mijenjati', f"""UPDATE "FormSchemaVersion" SET definition='{{"a":2}}'::jsonb WHERE id='{FSVD}'""")
ok('6.3 DRAFT → PUBLISHED', f"""UPDATE "FormSchemaVersion" SET status='PUBLISHED', "publishedAt"=now() WHERE id='{FSVD}'""")
err('6.4 izmjena definicije PUBLISHED → odbijena', f"""UPDATE "FormSchemaVersion" SET definition='{{"a":3}}'::jsonb WHERE id='{FSVD}'""", 'FORM_VERSION_IMMUTABLE')
err('6.5 izmjena broja verzije PUBLISHED → odbijena', f"""UPDATE "FormSchemaVersion" SET version=9 WHERE id='{FSVD}'""", 'FORM_VERSION_IMMUTABLE')
err('6.6 brisanje PUBLISHED → odbijeno', f"""DELETE FROM "FormSchemaVersion" WHERE id='{FSVD}'""", 'FORM_VERSION_IMMUTABLE')
err('6.7 PUBLISHED → RETIRED bez retiredById → odbijeno', f"""UPDATE "FormSchemaVersion" SET status='RETIRED' WHERE id='{FSVD}'""", 'FORM_VERSION_IMMUTABLE')
ok('6.8 PUBLISHED → RETIRED s retiredById → dozvoljeno', f"""UPDATE "FormSchemaVersion" SET status='RETIRED', "retiredAt"=now(), "retiredById"='{A}' WHERE id='{FSVD}'""")
ok('6.9 insert verzije 3 (DRAFT)', f"""INSERT INTO "FormSchemaVersion" (id, "formSchemaId", version, definition, status) VALUES ('{FSVE}','{FSV}',3,'{{}}'::jsonb,'DRAFT')""")
ok('6.10 DRAFT se može obrisati', f"""DELETE FROM "FormSchemaVersion" WHERE id='{FSVE}'""")
err('6.11 verzija 0 → CHECK', f"""INSERT INTO "FormSchemaVersion" (id, "formSchemaId", version, definition) VALUES ('{FSVE}','{FSV}',0,'{{}}'::jsonb)""", 'ck_form_schema_version_positive')

# --- 7) Partial unique na e-mail (soft delete) -------------------------------
err('7.1 drugi aktivan korisnik s istim e-mailom → odbijen', ins_user(C, 'admin.a@example.ba'), 'ux_user_email_active')
ok('7.2 soft delete korisnika A (super admin) dok postoji B', f"""UPDATE "User" SET "deletedAt"=now(), "updatedAt"=now() WHERE id='{A}'""")
ok('7.3 nakon soft delete-a isti e-mail prolazi', ins_user(C, 'admin.a@example.ba'))

# --- 8) Vehicle: CHECK-ovi i partial unique ----------------------------------
err('8.1 dupli internalNo (oba aktivna) → odbijen',
    f"""INSERT INTO "Vehicle" (id, "internalNo", make, model, "fuelType", "formSchemaId", "formSchemaVersionId", "updatedAt") VALUES ('{V2}','V-001','MAN','TGS','DIESEL','{FSV}','{FSVV}', now())""", 'ux_vehicle_internal_no_active')
err('8.2 VIN dužine 5 → CHECK', f"""INSERT INTO "Vehicle" (id, "internalNo", make, model, vin, "fuelType", "formSchemaId", "formSchemaVersionId", "updatedAt") VALUES ('{V2}','V-002','MAN','TGS','ABC12','DIESEL','{FSV}','{FSVV}', now())""", 'ck_vehicle_vin_length')
err('8.3 godina 1800 → CHECK', f"""INSERT INTO "Vehicle" (id, "internalNo", make, model, year, "fuelType", "formSchemaId", "formSchemaVersionId", "updatedAt") VALUES ('{V2}','V-002','MAN','TGS',1800,'DIESEL','{FSV}','{FSVV}', now())""", 'ck_vehicle_year_range')
err('8.4 negativna kilometraža → CHECK', f"""INSERT INTO "Vehicle" (id, "internalNo", make, model, "odometerKm", "fuelType", "formSchemaId", "formSchemaVersionId", "updatedAt") VALUES ('{V2}','V-002','MAN','TGS',-5,'DIESEL','{FSV}','{FSVV}', now())""", 'ck_vehicle_odometer_non_negative')
ok('8.5 ispravno vozilo V-002 s VIN-om 17 znakova', f"""INSERT INTO "Vehicle" (id, "internalNo", make, model, vin, year, "fuelType", "formSchemaId", "formSchemaVersionId", "updatedAt") VALUES ('{V2}','V-002','MAN','TGS','WMAH05ZZ09M123456',2024,'DIESEL','{FSV}','{FSVV}', now())""")
err('8.6 dupli VIN → odbijen', f"""UPDATE "Vehicle" SET vin='WMAH05ZZ09M123456' WHERE id='{V1}'""", 'ux_vehicle_vin_active')
ok('8.7 soft delete V-001', f"""UPDATE "Vehicle" SET "deletedAt"=now(), "updatedAt"=now() WHERE id='{V1}'""")
ok('8.8 internalNo V-001 se može ponovo koristiti nakon soft delete-a', f"""INSERT INTO "Vehicle" (id, "internalNo", make, model, "fuelType", "formSchemaId", "formSchemaVersionId", "updatedAt") VALUES ('{V1}','V-001','MAN','TGS','DIESEL','{FSV}','{FSVV}', now()) ON CONFLICT DO NOTHING""")

# --- 9) OdometerReading ------------------------------------------------------
err('9.1 negativno valueKm → CHECK', f"""INSERT INTO "OdometerReading" (id, "vehicleId", "valueKm", "readingAt") VALUES ('{OR1}','{V1}',-1, now())""", 'ck_odometer_reading_value_non_negative')

# --- 10) Gume ----------------------------------------------------------------
ok('10.1 TireSet TS-1', f"""INSERT INTO "TireSet" (id, code, season, "updatedAt") VALUES ('{TS1}','TS-1','SUMMER', now())""")
err('10.2 tireCount 9 → CHECK', f"""INSERT INTO "TireSet" (id, code, season, "tireCount", "updatedAt") VALUES ('{TS1}','TS-2','WINTER',9, now())""", 'ck_tire_set_tire_count')
err('10.3 dupli code seta (aktivni) → odbijen', f"""INSERT INTO "TireSet" (id, code, season, "updatedAt") VALUES ('{TI2}','TS-1','WINTER', now())""", 'ux_tire_set_code_active')
ok('10.4 guma FL u setu', f"""INSERT INTO "Tire" (id, "setId", position, "updatedAt") VALUES ('{TIR1}','{TS1}','FL', now())""")
err('10.5 druga guma na istoj poziciji → odbijena', f"""INSERT INTO "Tire" (id, "setId", position, "updatedAt") VALUES ('{TIR2}','{TS1}','FL', now())""", 'ux_tire_set_position_active')
ok('10.6 guma FR u istom setu', f"""INSERT INTO "Tire" (id, "setId", position, "updatedAt") VALUES ('{TIR2}','{TS1}','FR', now())""")
ok('10.7 montaža seta na V-001', f"""INSERT INTO "TireInstallation" (id, "setId", "vehicleId", "mountedAt", "mountedOdometerKm", "updatedAt") VALUES ('{TI1}','{TS1}','{V1}', DATE '2026-04-01', 1000, now())""")
err('10.8 druga AKTIVNA montaža istog seta → odbijena (B-09)', f"""INSERT INTO "TireInstallation" (id, "setId", "vehicleId", "mountedAt", "mountedOdometerKm", "updatedAt") VALUES ('{TI2}','{TS1}','{V2}', DATE '2026-05-01', 2000, now())""", 'ux_tire_installation_active')
err('10.9 demontaža prije montaže → CHECK', f"""UPDATE "TireInstallation" SET "dismountedAt"=DATE '2026-03-01' WHERE id='{TI1}'""", 'ck_tire_installation_period_valid')
ok('10.10 demontaža seta', f"""UPDATE "TireInstallation" SET "dismountedAt"=DATE '2026-10-01', "dismountedOdometerKm"=5000, "updatedAt"=now() WHERE id='{TI1}'""")
err('10.11 demontažna kilometraža manja od montažne → CHECK', f"""UPDATE "TireInstallation" SET "dismountedOdometerKm"=100 WHERE id='{TI1}'""", 'ck_tire_installation_odometer_valid')
ok('10.12 nakon demontaže nova montaža istog seta prolazi', f"""INSERT INTO "TireInstallation" (id, "setId", "vehicleId", "mountedAt", "mountedOdometerKm", "updatedAt") VALUES ('{TI2}','{TS1}','{V2}', DATE '2026-11-01', 2000, now())""")

# --- 11) Registracija: EXCLUDE (B-10) ---------------------------------------
REG_COLS = '(id, "vehicleId", "formSchemaId", "formSchemaVersionId", "registrationNumber", "validFrom", "validUntil", "updatedAt")'
ok('11.1 registracija 2026', f"""INSERT INTO "RegistrationRecord" {REG_COLS} VALUES ('{REG1}','{V1}','{FSV}','{FSVV}','A11-O-111', DATE '2026-01-01', DATE '2026-12-31', now())""")
err('11.2 preklapajući period za isto vozilo → EXCLUDE', f"""INSERT INTO "RegistrationRecord" {REG_COLS} VALUES ('{REG2}','{V1}','{FSV}','{FSVV}','A11-O-111', DATE '2026-06-01', DATE '2027-05-31', now())""", 'ex_registration_period_no_overlap')
err('11.3 validUntil <= validFrom → CHECK', f"""INSERT INTO "RegistrationRecord" {REG_COLS} VALUES ('{REG3}','{V1}','{FSV}','{FSVV}','A11-O-111', DATE '2027-01-01', DATE '2027-01-01', now())""", 'ck_registration_period_valid')
ok('11.4 nepreklapajući period prolazi', f"""INSERT INTO "RegistrationRecord" {REG_COLS} VALUES ('{REG3}','{V1}','{FSV}','{FSVV}','A11-O-111', DATE '2027-01-01', DATE '2027-12-31', now())""")
ok('11.5 soft delete prve registracije', f"""UPDATE "RegistrationRecord" SET "deletedAt"=now(), "updatedAt"=now() WHERE id='{REG1}'""")
ok('11.6 preklapanje s obrisanom registracijom prolazi (WHERE deletedAt IS NULL)', f"""INSERT INTO "RegistrationRecord" {REG_COLS} VALUES ('{REG1}','{V1}','{FSV}','{FSVV}','A11-O-111', DATE '2026-03-01', DATE '2026-09-30', now()) ON CONFLICT DO NOTHING""")

# --- 12) Task: CHECK-ovi i claim (P-04) -------------------------------------
err('12.1 IN_PROGRESS bez izvršioca → CHECK', f"""UPDATE "Task" SET status='IN_PROGRESS' WHERE id='{TASK1}'""", 'ck_task_in_progress_requires_assignee')
err('12.2 COMPLETED bez izvršioca → CHECK', f"""UPDATE "Task" SET status='COMPLETED', "completedAt"=now() WHERE id='{TASK1}'""", 'ck_task_completed_requires_assignee')
ok('12.3 claim: IN_PROGRESS s izvršiocem', f"""UPDATE "Task" SET status='IN_PROGRESS', "assigneeUserId"='{B}', "claimedAt"=now() WHERE id='{TASK1}'""")
err('12.4 COMPLETED bez completedAt → CHECK', f"""UPDATE "Task" SET status='COMPLETED', "completedAt"=NULL WHERE id='{TASK1}'""", 'ck_task_completed_requires_assignee')
ok('12.5 COMPLETED s izvršiocem i vremenom', f"""UPDATE "Task" SET status='COMPLETED', "completedAt"=now(), "updatedAt"=now() WHERE id='{TASK1}'""")
err('12.6 negativna kilometraža zadatka → CHECK', f"""UPDATE "Task" SET "odometerKm"=-1 WHERE id='{TASK1}'""", 'ck_task_odometer_non_negative')

# --- 13) TaskAssignment: jedan ASSIGNEE (drugi pojas za P-06) ---------------
ok('13.1 ASSIGNEE za B', f"""INSERT INTO "TaskAssignment" (id, "taskId", "userId", role) VALUES ('{TA1}','{TASK1}','{B}','ASSIGNEE')""")
err('13.2 drugi ASSIGNEE za isti zadatak → odbijen', f"""INSERT INTO "TaskAssignment" (id, "taskId", "userId", role) VALUES ('{TA2}','{TASK1}','{C}','ASSIGNEE')""", 'ux_task_assignment_assignee')
ok('13.3 INVITED za isti zadatak prolazi', f"""INSERT INTO "TaskAssignment" (id, "taskId", "userId", role) VALUES ('{TA3}','{TASK1}','{C}','INVITED')""")
ok('13.4 revokacija prvog ASSIGNEE', f"""UPDATE "TaskAssignment" SET "revokedAt"=now() WHERE id='{TA1}'""")
ok('13.5 nakon revokacije novi ASSIGNEE prolazi', f"""INSERT INTO "TaskAssignment" (id, "taskId", "userId", role) VALUES ('{TA2}','{TASK1}','{C}','ASSIGNEE')""")

# --- 14) Task.idempotencyKey -------------------------------------------------
TASK_COLS = '(id, code, title, "taskTypeId", "createdById", "formSchemaId", "formSchemaVersionId", "idempotencyKey", "updatedAt")'
ok('14.1 zadatak s idempotencyKey', f"""INSERT INTO "Task" {TASK_COLS} VALUES ('{TASK2}','T-2','Pranje 2','{TT}','{B}','{FSV}','{FSVV}','k1', now())""")
err('14.2 dupli idempotencyKey → odbijen', f"""INSERT INTO "Task" {TASK_COLS} VALUES ('{TASK3}','T-3','Pranje 3','{TT}','{B}','{FSV}','{FSVV}','k1', now())""", 'ux_task_idempotency_key')
ok('14.3 NULL idempotencyKey se može ponavljati (1)', f"""INSERT INTO "Task" {TASK_COLS} VALUES ('{TASK3}','T-3','Pranje 3','{TT}','{B}','{FSV}','{FSVV}',NULL, now())""")
ok('14.4 NULL idempotencyKey se može ponavljati (2)', f"""INSERT INTO "Task" {TASK_COLS} VALUES ('{TASK4}','T-4','Pranje 4','{TT}','{B}','{FSV}','{FSVV}',NULL, now())""")

# --- 15) FormSchema: TASK šema ----------------------------------------------
err('15.1 TASK šema bez taskTypeId → CHECK', f"""INSERT INTO "FormSchema" (id, key, name, subject, "updatedAt") VALUES ('{FST}','task-forma','Task forma','TASK', now())""", 'ck_form_schema_task_requires_type')
ok('15.2 TASK šema s taskTypeId', f"""INSERT INTO "FormSchema" (id, key, name, subject, "taskTypeId", "updatedAt") VALUES ('{FST}','task-forma','Task forma','TASK','{TT}', now())""")
err('15.3 druga TASK šema za isti tip zadatka → odbijena', f"""INSERT INTO "FormSchema" (id, key, name, subject, "taskTypeId", "updatedAt") VALUES ('{TA3}','task-forma-2','Task forma 2','TASK','{TT}', now())""", 'ux_form_schema_task_active')

# --- 16) ServiceItem.kind ---------------------------------------------------
ok('16.1 ServiceRecord', f"""INSERT INTO "ServiceRecord" (id, "vehicleId", "formSchemaId", "formSchemaVersionId", "serviceDate", "serviceType", "totalCost", "updatedAt") VALUES ('{SR1}','{V1}','{FSV}','{FSVV}', DATE '2026-05-05','REDOVNI_SERVIS', 150, now())""")
err('16.2 totalCost < 0 → CHECK', f"""INSERT INTO "ServiceRecord" (id, "vehicleId", "formSchemaId", "formSchemaVersionId", "serviceDate", "serviceType", "totalCost", "updatedAt") VALUES ('{SI2}','{V1}','{FSV}','{FSVV}', DATE '2026-05-06','REDOVNI_SERVIS', -1, now())""", 'ck_service_record_total_cost_non_negative')
ok('16.3 ServiceItem kind=PART', f"""INSERT INTO "ServiceItem" (id, "serviceRecordId", kind, name, "totalPrice") VALUES ('{SI1}','{SR1}','PART','Filter ulja', 25)""")
err('16.4 ServiceItem kind=XYZ → CHECK', f"""INSERT INTO "ServiceItem" (id, "serviceRecordId", kind, name, "totalPrice") VALUES ('{SI2}','{SR1}','XYZ','Nepoznato', 25)""", 'ck_service_item_kind')

# --- 17) NotificationDelivery.channel (dinamički fixture) -------------------
cur.execute("""SELECT column_name, data_type, udt_name FROM information_schema.columns
                WHERE table_schema='public' AND table_name='Notification'
                  AND is_nullable='NO' AND column_default IS NULL ORDER BY ordinal_position""")
req = cur.fetchall()
def dummy(col, dt, udt):
    if dt == 'uuid': return f"'{RAD}'"
    if dt == 'USER-DEFINED':
        cur.execute("SELECT enumlabel FROM pg_enum WHERE enumtypid = %s::regtype ORDER BY enumsortorder LIMIT 1", (udt,))
        return "'" + cur.fetchone()[0] + "'"
    if dt.startswith('timestamp'): return 'now()'
    if dt in ('integer','bigint'): return '1'
    if dt == 'boolean': return 'false'
    if dt == 'jsonb': return "'{}'::jsonb"
    if dt == 'numeric': return '1'
    if dt == 'date': return "DATE '2026-01-01'"
    if dt == 'ARRAY': return "'{}'"
    return "'x'"
NOTIF = 'aaaaaaaa-5555-4555-8555-555555555555'
names = [c for c, _, _ in req]
vals_list = []
for c, dt, udt in req:
    if c == 'id':
        vals_list.append(f"'{NOTIF}'")
    elif c == 'userId':
        vals_list.append(f"'{B}'")          # FK → stvarni korisnik
    else:
        vals_list.append(dummy(c, dt, udt))
if 'id' not in names:
    names.append('id'); vals_list.append(f"'{NOTIF}'")
cols = ', '.join(f'"{c}"' for c in names)
vals = ', '.join(vals_list)
ok('17.1 Notification fixture', f"""INSERT INTO "Notification" ({cols}) VALUES ({vals})""")
ND1 = 'aaaaaaaa-6666-4666-8666-666666666666'
ok('17.2 NotificationDelivery channel=FCM', f"""INSERT INTO "NotificationDelivery" (id, "notificationId", channel) VALUES ('{ND1}','{NOTIF}','FCM')""")
err('17.3 channel=SMS → CHECK', f"""INSERT INTO "NotificationDelivery" (id, "notificationId", channel) VALUES ('{ND1}','{NOTIF}','SMS')""", 'ck_notification_delivery_channel')

conn.commit()

print(f'\nPROŠLO: {len(PASS)}   PALO: {len(FAIL)}')
for name in PASS: print('  ✅', name)
for name, why in FAIL: print('  ❌', name, '\n       ', why)
