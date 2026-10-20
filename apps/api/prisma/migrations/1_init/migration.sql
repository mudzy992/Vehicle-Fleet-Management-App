-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'PENDING_PASSWORD_CHANGE');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('WEB', 'MOBILE_ANDROID', 'MOBILE_IOS', 'SERVICE');

-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('ALL', 'OWN', 'VEHICLE_IDS', 'DRIVER_IDS');

-- CreateEnum
CREATE TYPE "FormSchemaStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "FormSubject" AS ENUM ('VEHICLE', 'DRIVER', 'REGISTRATION', 'INSURANCE', 'SERVICE', 'TIRE_SET', 'TIRE_INSTALLATION', 'TASK', 'VEHICLE_HANDOVER', 'OTHER');

-- CreateEnum
CREATE TYPE "MigrationJobStatus" AS ENUM ('PENDING', 'PREVIEW', 'RUNNING', 'COMPLETED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'IN_SERVICE', 'INACTIVE', 'DAMAGED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('DIESEL', 'PETROL', 'LPG', 'CNG', 'HYBRID', 'ELECTRIC');

-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OdometerSource" AS ENUM ('MANUAL', 'TASK', 'SERVICE', 'REGISTRATION', 'INSURANCE', 'TIRE', 'HANDOVER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "TireSeason" AS ENUM ('SUMMER', 'WINTER', 'ALL_SEASON');

-- CreateEnum
CREATE TYPE "TireStatus" AS ENUM ('IN_STOCK', 'MOUNTED', 'IN_REPAIR', 'RETIRED', 'SCRAPPED');

-- CreateEnum
CREATE TYPE "TirePosition" AS ENUM ('FL', 'FR', 'RL', 'RR', 'SPARE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskAssignMode" AS ENUM ('OPEN_CLAIM', 'ASSIGN_DIRECT', 'BROADCAST');

-- CreateEnum
CREATE TYPE "TaskEventAction" AS ENUM ('CREATED', 'UPDATED', 'ASSIGNED', 'INVITED', 'CLAIMED', 'COMPLETED', 'CANCELLED', 'REOPENED', 'RELEASED', 'COMMENTED', 'ATTACHMENT_ADDED', 'OVERRIDE_COMPLETED', 'FORM_MIGRATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AttachmentOwnerType" AS ENUM ('TASK', 'VEHICLE', 'SERVICE', 'REGISTRATION', 'INSURANCE', 'TIRE', 'DRIVER', 'REPORT_EXPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "AttachmentStage" AS ENUM ('ON_CREATE', 'ON_CLAIM', 'ON_COMPLETE', 'ON_CANCEL', 'GENERAL');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'TOKEN_INVALID');

-- CreateEnum
CREATE TYPE "DeviceTokenStatus" AS ENUM ('ACTIVE', 'INVALID', 'UNREGISTERED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('REGISTRATION', 'INSURANCE', 'SERVICE_DATE', 'SERVICE_KM', 'DRIVER_LICENSE', 'TECHNICAL_INSPECTION', 'TIRE_ROTATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('SCHEDULED', 'SENT', 'ACKNOWLEDGED', 'SNOOZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'ARCHIVE', 'RESTORE', 'LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'PERMISSION_CHANGE', 'ROLE_CHANGE', 'FORM_PUBLISH', 'FORM_RETIRE', 'FORM_MIGRATE', 'EXPORT', 'FILE_ACCESS', 'SECURITY', 'SETTINGS_CHANGE', 'CLAIM', 'COMPLETE', 'CANCEL', 'REOPEN', 'RELEASE');

-- CreateEnum
CREATE TYPE "AuditSeverity" AS ENUM ('INFO', 'WARN', 'SECURITY', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('PDF', 'XLSX', 'CSV');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SettingType" AS ENUM ('STRING', 'INTEGER', 'DECIMAL', 'BOOLEAN', 'DATE', 'ENUM', 'JSON', 'SECRET');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "displayName" TEXT,
    "phone" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMPTZ(6),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Sarajevo',
    "locale" TEXT NOT NULL DEFAULT 'bs',
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "allowedClientTypes" "ClientType"[] DEFAULT ARRAY['WEB', 'MOBILE_ANDROID']::"ClientType"[],
    "permissionsVersion" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "scope" "PermissionScope" NOT NULL DEFAULT 'ALL',
    "scopeVehicleIds" UUID[],
    "scopeDriverIds" UUID[],
    "conditions" JSONB,
    "grantedById" UUID,
    "grantedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "assignedById" UUID,
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "validFrom" TIMESTAMPTZ(6),
    "validUntil" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserIdentity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "clientType" "ClientType" NOT NULL,
    "deviceInfo" JSONB,
    "ipAddress" INET,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "replacedById" UUID,
    "lastUsedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAttempt" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "userId" UUID,
    "success" BOOLEAN NOT NULL,
    "clientType" "ClientType" NOT NULL,
    "ipAddress" INET,
    "userAgent" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" UUID NOT NULL,
    "internalNo" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "vin" TEXT,
    "plateNumber" TEXT,
    "fuelType" "FuelType" NOT NULL,
    "transmission" TEXT,
    "color" TEXT,
    "bodyType" TEXT,
    "engineCcm" INTEGER,
    "enginePowerKw" INTEGER,
    "seats" INTEGER,
    "ownershipType" TEXT NOT NULL DEFAULT 'OWNED',
    "acquisitionDate" DATE,
    "acquisitionPrice" INTEGER,
    "costCenter" TEXT,
    "odometerKm" INTEGER NOT NULL DEFAULT 0,
    "odometerUpdatedAt" TIMESTAMPTZ(6),
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "registrationExpiresAt" DATE,
    "insuranceExpiresAt" DATE,
    "nextServiceDueDate" DATE,
    "nextServiceDueKm" INTEGER,
    "photoAttachmentId" UUID,
    "notes" TEXT,
    "formSchemaId" UUID NOT NULL,
    "formSchemaVersionId" UUID NOT NULL,
    "formData" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),
    "archivedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OdometerReading" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "valueKm" INTEGER NOT NULL,
    "source" "OdometerSource" NOT NULL DEFAULT 'MANUAL',
    "referenceType" TEXT,
    "referenceId" UUID,
    "readingAt" TIMESTAMPTZ(6) NOT NULL,
    "recordedById" UUID,
    "isCorrection" BOOLEAN NOT NULL DEFAULT false,
    "correctionReason" TEXT,
    "previousValueKm" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OdometerReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationRecord" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "formSchemaId" UUID NOT NULL,
    "formSchemaVersionId" UUID NOT NULL,
    "formData" JSONB NOT NULL DEFAULT '{}',
    "registrationNumber" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "issuedBy" TEXT,
    "costAmount" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'BAM',
    "attachmentIds" UUID[],
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "RegistrationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceRecord" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "formSchemaId" UUID NOT NULL,
    "formSchemaVersionId" UUID NOT NULL,
    "formData" JSONB NOT NULL DEFAULT '{}',
    "policyNumber" TEXT,
    "insuranceCompany" TEXT,
    "type" TEXT,
    "validFrom" DATE NOT NULL,
    "validUntil" DATE NOT NULL,
    "premiumAmount" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'BAM',
    "deductibleAmount" INTEGER,
    "attachmentIds" UUID[],
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "InsuranceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceRecord" (
    "id" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "formSchemaId" UUID NOT NULL,
    "formSchemaVersionId" UUID NOT NULL,
    "formData" JSONB NOT NULL DEFAULT '{}',
    "serviceDate" DATE NOT NULL,
    "odometerKm" INTEGER,
    "serviceType" TEXT NOT NULL,
    "workshopId" UUID,
    "workshopName" TEXT,
    "description" TEXT,
    "partsReplaced" TEXT,
    "laborCost" INTEGER,
    "partsCost" INTEGER,
    "totalCost" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'BAM',
    "nextServiceDueDate" DATE,
    "nextServiceDueKm" INTEGER,
    "invoiceNumber" TEXT,
    "attachmentIds" UUID[],
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ServiceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceItem" (
    "id" UUID NOT NULL,
    "serviceRecordId" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'OTHER',
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1.00,
    "unitPrice" INTEGER,
    "totalPrice" INTEGER NOT NULL,
    "partNumber" TEXT,
    "notes" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ServiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "email" CITEXT,
    "dateOfBirth" DATE,
    "address" TEXT,
    "employeeNumber" TEXT,
    "employmentStatus" TEXT,
    "licenseNumber" TEXT,
    "licenseIssuedAt" DATE,
    "licenseExpiresAt" DATE,
    "licenseIssuingAuthority" TEXT,
    "restrictions" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "photoAttachmentId" UUID,
    "formSchemaId" UUID,
    "formSchemaVersionId" UUID,
    "formData" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverLicenseCategory" (
    "id" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "issuedAt" DATE,
    "expiresAt" DATE,
    "restrictions" TEXT,
    "notes" TEXT,

    CONSTRAINT "DriverLicenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TireSet" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "size" TEXT,
    "width" INTEGER,
    "aspectRatio" INTEGER,
    "diameterInches" DECIMAL(4,1),
    "loadIndex" INTEGER,
    "speedIndex" TEXT,
    "season" "TireSeason" NOT NULL,
    "tireCount" INTEGER NOT NULL DEFAULT 4,
    "purchaseDate" DATE,
    "purchasePrice" INTEGER,
    "currency" CHAR(3) NOT NULL DEFAULT 'BAM',
    "status" "TireStatus" NOT NULL DEFAULT 'IN_STOCK',
    "currentLocation" TEXT,
    "notes" TEXT,
    "formSchemaId" UUID,
    "formSchemaVersionId" UUID,
    "formData" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TireSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tire" (
    "id" UUID NOT NULL,
    "setId" UUID,
    "serialNumber" TEXT,
    "dot" TEXT,
    "productionWeek" INTEGER,
    "productionYear" INTEGER,
    "position" "TirePosition",
    "treadDepthMm" DECIMAL(4,1),
    "status" "TireStatus" NOT NULL DEFAULT 'IN_STOCK',
    "purchaseDate" DATE,
    "purchasePrice" INTEGER,
    "notes" TEXT,
    "formData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Tire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TireInstallation" (
    "id" UUID NOT NULL,
    "setId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "mountedAt" DATE NOT NULL,
    "mountedOdometerKm" INTEGER NOT NULL,
    "dismountedAt" DATE,
    "dismountedOdometerKm" INTEGER,
    "reason" TEXT,
    "positions" "TirePosition"[],
    "storageLocationOnDismount" TEXT,
    "daysInUse" INTEGER,
    "kmDriven" INTEGER,
    "formSchemaId" UUID,
    "formSchemaVersionId" UUID,
    "formData" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TireInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSchema" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" "FormSubject" NOT NULL,
    "taskTypeId" UUID,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currentPublishedVersionId" UUID,
    "ownerModule" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "FormSchema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSchemaVersion" (
    "id" UUID NOT NULL,
    "formSchemaId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "FormSchemaStatus" NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "contentHash" TEXT,
    "changeNote" TEXT,
    "publishedAt" TIMESTAMPTZ(6),
    "publishedById" UUID,
    "retiredAt" TIMESTAMPTZ(6),
    "retiredById" UUID,
    "normalizedName" JSONB,
    "compatibility" JSONB,
    "mobileCompatible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "FormSchemaVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldKeyRegistry" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "unit" TEXT,
    "normalizedColumn" TEXT,
    "usedByFormSchemaIds" UUID[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "FieldKeyRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormMigrationJob" (
    "id" UUID NOT NULL,
    "formSchemaId" UUID NOT NULL,
    "fromVersionId" UUID NOT NULL,
    "toVersionId" UUID NOT NULL,
    "targetEntityType" TEXT NOT NULL,
    "targetEntityIds" UUID[],
    "filter" JSONB,
    "status" "MigrationJobStatus" NOT NULL DEFAULT 'PENDING',
    "previewResult" JSONB,
    "requestedById" UUID,
    "startedAt" TIMESTAMPTZ(6),
    "finishedAt" TIMESTAMPTZ(6),
    "summary" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormMigrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormMigrationItem" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "processedAt" TIMESTAMPTZ(6),

    CONSTRAINT "FormMigrationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskType" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconName" TEXT,
    "colorHex" TEXT,
    "requiresVehicle" BOOLEAN NOT NULL DEFAULT true,
    "requiresOdometer" BOOLEAN NOT NULL DEFAULT false,
    "requiresPhotos" BOOLEAN NOT NULL DEFAULT false,
    "defaultPriority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "defaultAssignMode" "TaskAssignMode" NOT NULL DEFAULT 'OPEN_CLAIM',
    "allowMultipleClaimants" BOOLEAN NOT NULL DEFAULT false,
    "dueOffsetHours" INTEGER,
    "formSchemaId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TaskType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "vehicleId" UUID,
    "taskTypeId" UUID NOT NULL,
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "assignMode" "TaskAssignMode" NOT NULL DEFAULT 'OPEN_CLAIM',
    "createdById" UUID NOT NULL,
    "assigneeUserId" UUID,
    "claimedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "completedById" UUID,
    "dueAt" TIMESTAMPTZ(6),
    "dueDate" DATE,
    "cancelledAt" TIMESTAMPTZ(6),
    "cancelReason" TEXT,
    "reopenedAt" TIMESTAMPTZ(6),
    "releasedAt" TIMESTAMPTZ(6),
    "durationMinutes" INTEGER,
    "odometerKm" INTEGER,
    "totalCost" INTEGER,
    "fuelLiters" DECIMAL(10,2),
    "fuelAmount" INTEGER,
    "fuelConsumptionL100" DECIMAL(6,2),
    "formSchemaId" UUID NOT NULL,
    "formSchemaVersionId" UUID NOT NULL,
    "formData" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'INVITED',
    "assignedById" UUID,
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),
    "note" TEXT,

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "action" "TaskEventAction" NOT NULL,
    "actorId" UUID,
    "actorRole" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" INET,
    "clientType" "ClientType",
    "requestId" TEXT,
    "data" JSONB,
    "formSchemaVersionId" UUID,

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "mentionsUserIds" UUID[],
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCompletionRequirement" (
    "id" UUID NOT NULL,
    "taskTypeId" UUID NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "stage" "AttachmentStage" NOT NULL DEFAULT 'GENERAL',
    "minPhotos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TaskCompletionRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lockedAt" TIMESTAMPTZ(6),
    "lockedBy" TEXT,
    "availableAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB,
    "linkToType" TEXT,
    "linkToId" UUID,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(6),
    "outboxEventId" UUID,
    "notificationKey" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "deviceTokenId" UUID,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMPTZ(6),
    "deliveredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'android',
    "appVersion" TEXT,
    "deviceModel" TEXT,
    "osVersion" TEXT,
    "locale" TEXT,
    "status" "DeviceTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMPTZ(6),
    "lastError" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "channelFcm" BOOLEAN NOT NULL DEFAULT true,
    "channelInApp" BOOLEAN NOT NULL DEFAULT true,
    "channelEmail" BOOLEAN NOT NULL DEFAULT false,
    "quietHoursStart" TIME,
    "quietHoursEnd" TIME,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderPolicy" (
    "id" UUID NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "thresholdsDays" INTEGER[] DEFAULT ARRAY[5]::INTEGER[],
    "thresholdsKm" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "recipientsPermission" TEXT NOT NULL DEFAULT 'vehicle:view',
    "recipientRoleIds" UUID[],
    "channels" TEXT[] DEFAULT ARRAY['IN_APP', 'FCM']::TEXT[],
    "escalate" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ReminderPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledReminder" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "dueDate" DATE,
    "dueKm" INTEGER,
    "thresholdDays" INTEGER,
    "thresholdKm" INTEGER,
    "fireAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'SCHEDULED',
    "dedupeKey" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(6),
    "acknowledgedById" UUID,
    "acknowledgedAt" TIMESTAMPTZ(6),
    "outboxEventId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "ownerType" "AttachmentOwnerType" NOT NULL,
    "stage" "AttachmentStage" NOT NULL DEFAULT 'GENERAL',
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "exifStripped" BOOLEAN NOT NULL DEFAULT true,
    "uploadedById" TEXT NOT NULL,
    "taskId" UUID,
    "formFieldKey" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "actorId" UUID,
    "actorEmail" TEXT,
    "actorRoles" TEXT[],
    "action" "AuditAction" NOT NULL,
    "severity" "AuditSeverity" NOT NULL DEFAULT 'INFO',
    "entityType" TEXT,
    "entityId" UUID,
    "entityCode" TEXT,
    "before" JSONB,
    "after" JSONB,
    "changedFields" TEXT[],
    "reason" TEXT,
    "requestId" TEXT,
    "ipAddress" INET,
    "userAgent" TEXT,
    "clientType" "ClientType",
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "type" "SettingType" NOT NULL,
    "schema" JSONB,
    "category" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "List" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "List_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListItem" (
    "id" UUID NOT NULL,
    "listId" UUID NOT NULL,
    "code" TEXT,
    "label" TEXT NOT NULL,
    "value" JSONB,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "parentId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT,
    "path" TEXT,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportDefinition" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "sourceView" TEXT NOT NULL,
    "columns" JSONB,
    "defaultFilters" JSONB,
    "requiredPermission" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ReportDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" UUID NOT NULL,
    "reportDefinitionId" UUID NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "filters" JSONB,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "requestedById" UUID,
    "rowCount" INTEGER,
    "attachmentId" UUID,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMPTZ(6),
    "finishedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_lastName_firstName_idx" ON "User"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE INDEX "Permission_module_idx" ON "Permission"("module");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_module_action_key" ON "Permission"("module", "action");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionId_key" ON "RolePermission"("roleId", "permissionId");

-- CreateIndex
CREATE INDEX "UserRole_userId_idx" ON "UserRole"("userId");

-- CreateIndex
CREATE INDEX "UserRole_roleId_idx" ON "UserRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");

-- CreateIndex
CREATE INDEX "UserIdentity_driverId_idx" ON "UserIdentity"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "UserIdentity_userId_driverId_key" ON "UserIdentity"("userId", "driverId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_expiresAt_idx" ON "RefreshSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "RefreshSession_familyId_idx" ON "RefreshSession"("familyId");

-- CreateIndex
CREATE INDEX "AuthAttempt_email_createdAt_idx" ON "AuthAttempt"("email", "createdAt");

-- CreateIndex
CREATE INDEX "AuthAttempt_ipAddress_createdAt_idx" ON "AuthAttempt"("ipAddress", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_photoAttachmentId_key" ON "Vehicle"("photoAttachmentId");

-- CreateIndex
CREATE INDEX "Vehicle_status_idx" ON "Vehicle"("status");

-- CreateIndex
CREATE INDEX "Vehicle_registrationExpiresAt_idx" ON "Vehicle"("registrationExpiresAt");

-- CreateIndex
CREATE INDEX "Vehicle_insuranceExpiresAt_idx" ON "Vehicle"("insuranceExpiresAt");

-- CreateIndex
CREATE INDEX "Vehicle_nextServiceDueDate_idx" ON "Vehicle"("nextServiceDueDate");

-- CreateIndex
CREATE INDEX "Vehicle_make_model_idx" ON "Vehicle"("make", "model");

-- CreateIndex
CREATE INDEX "Vehicle_plateNumber_idx" ON "Vehicle"("plateNumber");

-- CreateIndex
CREATE INDEX "Vehicle_deletedAt_idx" ON "Vehicle"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_internalNo_key" ON "Vehicle"("internalNo");

-- CreateIndex
CREATE INDEX "OdometerReading_vehicleId_readingAt_idx" ON "OdometerReading"("vehicleId", "readingAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "OdometerReading_vehicleId_readingAt_valueKm_source_key" ON "OdometerReading"("vehicleId", "readingAt", "valueKm", "source");

-- CreateIndex
CREATE INDEX "RegistrationRecord_vehicleId_validUntil_idx" ON "RegistrationRecord"("vehicleId", "validUntil" DESC);

-- CreateIndex
CREATE INDEX "RegistrationRecord_validUntil_idx" ON "RegistrationRecord"("validUntil");

-- CreateIndex
CREATE INDEX "InsuranceRecord_vehicleId_validUntil_idx" ON "InsuranceRecord"("vehicleId", "validUntil" DESC);

-- CreateIndex
CREATE INDEX "InsuranceRecord_validUntil_idx" ON "InsuranceRecord"("validUntil");

-- CreateIndex
CREATE INDEX "ServiceRecord_vehicleId_serviceDate_idx" ON "ServiceRecord"("vehicleId", "serviceDate" DESC);

-- CreateIndex
CREATE INDEX "ServiceRecord_nextServiceDueDate_idx" ON "ServiceRecord"("nextServiceDueDate");

-- CreateIndex
CREATE INDEX "ServiceRecord_serviceType_idx" ON "ServiceRecord"("serviceType");

-- CreateIndex
CREATE INDEX "ServiceItem_serviceRecordId_idx" ON "ServiceItem"("serviceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_photoAttachmentId_key" ON "Driver"("photoAttachmentId");

-- CreateIndex
CREATE INDEX "Driver_lastName_firstName_idx" ON "Driver"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Driver_licenseExpiresAt_idx" ON "Driver"("licenseExpiresAt");

-- CreateIndex
CREATE INDEX "Driver_deletedAt_idx" ON "Driver"("deletedAt");

-- CreateIndex
CREATE INDEX "DriverLicenseCategory_expiresAt_idx" ON "DriverLicenseCategory"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DriverLicenseCategory_driverId_category_key" ON "DriverLicenseCategory"("driverId", "category");

-- CreateIndex
CREATE INDEX "TireSet_season_status_idx" ON "TireSet"("season", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TireSet_code_key" ON "TireSet"("code");

-- CreateIndex
CREATE INDEX "Tire_status_idx" ON "Tire"("status");

-- CreateIndex
CREATE INDEX "Tire_setId_idx" ON "Tire"("setId");

-- CreateIndex
CREATE INDEX "TireInstallation_vehicleId_mountedAt_idx" ON "TireInstallation"("vehicleId", "mountedAt" DESC);

-- CreateIndex
CREATE INDEX "TireInstallation_setId_mountedAt_idx" ON "TireInstallation"("setId", "mountedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "FormSchema_key_key" ON "FormSchema"("key");

-- CreateIndex
CREATE INDEX "FormSchema_subject_idx" ON "FormSchema"("subject");

-- CreateIndex
CREATE INDEX "FormSchemaVersion_formSchemaId_status_publishedAt_idx" ON "FormSchemaVersion"("formSchemaId", "status", "publishedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "FormSchemaVersion_formSchemaId_version_key" ON "FormSchemaVersion"("formSchemaId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "FieldKeyRegistry_key_key" ON "FieldKeyRegistry"("key");

-- CreateIndex
CREATE INDEX "FormMigrationJob_status_createdAt_idx" ON "FormMigrationJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FormMigrationItem_jobId_entityId_key" ON "FormMigrationItem"("jobId", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskType_code_key" ON "TaskType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Task_code_key" ON "Task"("code");

-- CreateIndex
CREATE INDEX "Task_status_dueAt_idx" ON "Task"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_vehicleId_createdAt_idx" ON "Task"("vehicleId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Task_assigneeUserId_status_idx" ON "Task"("assigneeUserId", "status");

-- CreateIndex
CREATE INDEX "Task_taskTypeId_status_idx" ON "Task"("taskTypeId", "status");

-- CreateIndex
CREATE INDEX "Task_createdById_createdAt_idx" ON "Task"("createdById", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "TaskAssignment_userId_idx" ON "TaskAssignment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignment_taskId_userId_role_key" ON "TaskAssignment"("taskId", "userId", "role");

-- CreateIndex
CREATE INDEX "TaskEvent_taskId_at_idx" ON "TaskEvent"("taskId", "at");

-- CreateIndex
CREATE INDEX "TaskEvent_actorId_at_idx" ON "TaskEvent"("actorId", "at");

-- CreateIndex
CREATE INDEX "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCompletionRequirement_taskTypeId_fieldKey_key" ON "TaskCompletionRequirement"("taskTypeId", "fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_idempotencyKey_key" ON "OutboxEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_notificationKey_key" ON "Notification"("notificationKey");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_createdAt_idx" ON "Notification"("userId", "isRead", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "NotificationDelivery_notificationId_idx" ON "NotificationDelivery"("notificationId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_createdAt_idx" ON "NotificationDelivery"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_tokenHash_key" ON "DeviceToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_status_idx" ON "DeviceToken"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_type_key" ON "NotificationPreference"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderPolicy_kind_key" ON "ReminderPolicy"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledReminder_dedupeKey_key" ON "ScheduledReminder"("dedupeKey");

-- CreateIndex
CREATE INDEX "ScheduledReminder_status_fireAt_idx" ON "ScheduledReminder"("status", "fireAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_sha256_idx" ON "Attachment"("sha256");

-- CreateIndex
CREATE INDEX "Attachment_uploadedById_createdAt_idx" ON "Attachment"("uploadedById", "createdAt");

-- CreateIndex
CREATE INDEX "Attachment_deletedAt_idx" ON "Attachment"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_ownerType_ownerId_sha256_key" ON "Attachment"("ownerType", "ownerId", "sha256");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_severity_createdAt_idx" ON "AuditLog"("severity", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Setting_key_key" ON "Setting"("key");

-- CreateIndex
CREATE INDEX "Setting_category_idx" ON "Setting"("category");

-- CreateIndex
CREATE UNIQUE INDEX "List_code_key" ON "List"("code");

-- CreateIndex
CREATE INDEX "ListItem_listId_sortOrder_idx" ON "ListItem"("listId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ListItem_listId_code_key" ON "ListItem"("listId", "code");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_userId_key_key" ON "IdempotencyKey"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ReportDefinition_code_key" ON "ReportDefinition"("code");

-- CreateIndex
CREATE INDEX "ExportJob_requestedById_createdAt_idx" ON "ExportJob"("requestedById", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ExportJob_status_idx" ON "ExportJob"("status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIdentity" ADD CONSTRAINT "UserIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserIdentity" ADD CONSTRAINT "UserIdentity_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthAttempt" ADD CONSTRAINT "AuthAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_formSchemaId_fkey" FOREIGN KEY ("formSchemaId") REFERENCES "FormSchema"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_formSchemaVersionId_fkey" FOREIGN KEY ("formSchemaVersionId") REFERENCES "FormSchemaVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_photoAttachmentId_fkey" FOREIGN KEY ("photoAttachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OdometerReading" ADD CONSTRAINT "OdometerReading_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OdometerReading" ADD CONSTRAINT "OdometerReading_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationRecord" ADD CONSTRAINT "RegistrationRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationRecord" ADD CONSTRAINT "RegistrationRecord_formSchemaId_fkey" FOREIGN KEY ("formSchemaId") REFERENCES "FormSchema"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationRecord" ADD CONSTRAINT "RegistrationRecord_formSchemaVersionId_fkey" FOREIGN KEY ("formSchemaVersionId") REFERENCES "FormSchemaVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceRecord" ADD CONSTRAINT "InsuranceRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceRecord" ADD CONSTRAINT "InsuranceRecord_formSchemaId_fkey" FOREIGN KEY ("formSchemaId") REFERENCES "FormSchema"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceRecord" ADD CONSTRAINT "InsuranceRecord_formSchemaVersionId_fkey" FOREIGN KEY ("formSchemaVersionId") REFERENCES "FormSchemaVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRecord" ADD CONSTRAINT "ServiceRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRecord" ADD CONSTRAINT "ServiceRecord_formSchemaId_fkey" FOREIGN KEY ("formSchemaId") REFERENCES "FormSchema"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRecord" ADD CONSTRAINT "ServiceRecord_formSchemaVersionId_fkey" FOREIGN KEY ("formSchemaVersionId") REFERENCES "FormSchemaVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceRecord" ADD CONSTRAINT "ServiceRecord_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "ListItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceItem" ADD CONSTRAINT "ServiceItem_serviceRecordId_fkey" FOREIGN KEY ("serviceRecordId") REFERENCES "ServiceRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_photoAttachmentId_fkey" FOREIGN KEY ("photoAttachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_formSchemaId_fkey" FOREIGN KEY ("formSchemaId") REFERENCES "FormSchema"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_formSchemaVersionId_fkey" FOREIGN KEY ("formSchemaVersionId") REFERENCES "FormSchemaVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverLicenseCategory" ADD CONSTRAINT "DriverLicenseCategory_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TireSet" ADD CONSTRAINT "TireSet_formSchemaId_fkey" FOREIGN KEY ("formSchemaId") REFERENCES "FormSchema"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TireSet" ADD CONSTRAINT "TireSet_formSchemaVersionId_fkey" FOREIGN KEY ("formSchemaVersionId") REFERENCES "FormSchemaVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tire" ADD CONSTRAINT "Tire_setId_fkey" FOREIGN KEY ("setId") REFERENCES "TireSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TireInstallation" ADD CONSTRAINT "TireInstallation_setId_fkey" FOREIGN KEY ("setId") REFERENCES "TireSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TireInstallation" ADD CONSTRAINT "TireInstallation_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TireInstallation" ADD CONSTRAINT "TireInstallation_formSchemaId_fkey" FOREIGN KEY ("formSchemaId") REFERENCES "FormSchema"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TireInstallation" ADD CONSTRAINT "TireInstallation_formSchemaVersionId_fkey" FOREIGN KEY ("formSchemaVersionId") REFERENCES "FormSchemaVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSchema" ADD CONSTRAINT "FormSchema_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "TaskType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSchema" ADD CONSTRAINT "FormSchema_currentPublishedVersionId_fkey" FOREIGN KEY ("currentPublishedVersionId") REFERENCES "FormSchemaVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormSchemaVersion" ADD CONSTRAINT "FormSchemaVersion_formSchemaId_fkey" FOREIGN KEY ("formSchemaId") REFERENCES "FormSchema"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormMigrationJob" ADD CONSTRAINT "FormMigrationJob_formSchemaId_fkey" FOREIGN KEY ("formSchemaId") REFERENCES "FormSchema"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormMigrationJob" ADD CONSTRAINT "FormMigrationJob_fromVersionId_fkey" FOREIGN KEY ("fromVersionId") REFERENCES "FormSchemaVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormMigrationJob" ADD CONSTRAINT "FormMigrationJob_toVersionId_fkey" FOREIGN KEY ("toVersionId") REFERENCES "FormSchemaVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormMigrationItem" ADD CONSTRAINT "FormMigrationItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "FormMigrationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskType" ADD CONSTRAINT "TaskType_formSchemaId_fkey" FOREIGN KEY ("formSchemaId") REFERENCES "FormSchema"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "TaskType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_formSchemaId_fkey" FOREIGN KEY ("formSchemaId") REFERENCES "FormSchema"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_formSchemaVersionId_fkey" FOREIGN KEY ("formSchemaVersionId") REFERENCES "FormSchemaVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvent" ADD CONSTRAINT "TaskEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCompletionRequirement" ADD CONSTRAINT "TaskCompletionRequirement_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "TaskType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_outboxEventId_fkey" FOREIGN KEY ("outboxEventId") REFERENCES "OutboxEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_deviceTokenId_fkey" FOREIGN KEY ("deviceTokenId") REFERENCES "DeviceToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReminder" ADD CONSTRAINT "ScheduledReminder_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ReminderPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledReminder" ADD CONSTRAINT "ScheduledReminder_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ListItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_reportDefinitionId_fkey" FOREIGN KEY ("reportDefinitionId") REFERENCES "ReportDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

