-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'EXECUTIVE', 'QUALITY_ADMIN', 'DEPARTMENT_ADMIN', 'DATA_ENTRY', 'VIEWER');

-- CreateEnum
CREATE TYPE "SubmissionState" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('GREEN', 'YELLOW', 'RED', 'NO_DATA');

-- CreateEnum
CREATE TYPE "CalculationMode" AS ENUM ('DIRECT_VALUE', 'PERCENTAGE', 'RATE', 'RATIO', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TargetType" AS ENUM ('GTE', 'LTE', 'BETWEEN');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('MANUAL', 'CSV_IMPORT', 'HIS', 'SYSTEM');

-- CreateTable
CREATE TABLE "OrganizationSettings" (
    "id" TEXT NOT NULL DEFAULT 'organization',
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameTh" TEXT NOT NULL,
    "nameEn" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "departmentId" TEXT,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiDefinition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameTh" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "departmentId" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "frequency" "Frequency" NOT NULL DEFAULT 'MONTHLY',
    "calculationMode" "CalculationMode" NOT NULL DEFAULT 'DIRECT_VALUE',
    "targetType" "TargetType" NOT NULL DEFAULT 'GTE',
    "targetValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "targetMin" DOUBLE PRECISION,
    "targetMax" DOUBLE PRECISION,
    "warningThreshold" DOUBLE PRECISION,
    "warningMin" DOUBLE PRECISION,
    "warningMax" DOUBLE PRECISION,
    "decimalPlaces" INTEGER NOT NULL DEFAULT 2,
    "rateMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1000,
    "dataSourceType" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "dataSourceId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "owner" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiTarget" (
    "id" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "targetType" "TargetType" NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "targetMin" DOUBLE PRECISION,
    "targetMax" DOUBLE PRECISION,
    "warningThreshold" DOUBLE PRECISION,
    "warningMin" DOUBLE PRECISION,
    "warningMax" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiSubmission" (
    "id" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "numerator" DOUBLE PRECISION,
    "denominator" DOUBLE PRECISION,
    "value" DOUBLE PRECISION,
    "note" TEXT NOT NULL DEFAULT '',
    "source" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "state" "SubmissionState" NOT NULL DEFAULT 'DRAFT',
    "authorId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "rejectionReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiResult" (
    "id" TEXT NOT NULL,
    "kpiId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "numerator" DOUBLE PRECISION,
    "denominator" DOUBLE PRECISION,
    "value" DOUBLE PRECISION,
    "status" "Status" NOT NULL,
    "targetSnapshot" JSONB NOT NULL,
    "submissionId" TEXT,
    "source" "SourceType" NOT NULL DEFAULT 'MANUAL',
    "synthetic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "schedule" TEXT NOT NULL DEFAULT '*/5 * * * *',
    "staleAfterMinutes" INTEGER NOT NULL DEFAULT 60,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "departmentId" TEXT,
    "kpiId" TEXT,
    "message" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" TEXT NOT NULL,
    "departmentId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL DEFAULT 'worker',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_departmentId_role_idx" ON "User"("departmentId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "KpiDefinition_code_key" ON "KpiDefinition"("code");

-- CreateIndex
CREATE INDEX "KpiDefinition_departmentId_active_displayOrder_idx" ON "KpiDefinition"("departmentId", "active", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "KpiTarget_kpiId_effectiveFrom_key" ON "KpiTarget"("kpiId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "KpiSubmission_kpiId_state_periodStart_idx" ON "KpiSubmission"("kpiId", "state", "periodStart");

-- CreateIndex
CREATE INDEX "KpiSubmission_authorId_state_idx" ON "KpiSubmission"("authorId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "KpiResult_submissionId_key" ON "KpiResult"("submissionId");

-- CreateIndex
CREATE INDEX "KpiResult_periodStart_status_idx" ON "KpiResult"("periodStart", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KpiResult_kpiId_periodStart_periodEnd_key" ON "KpiResult"("kpiId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_name_key" ON "DataSource"("name");

-- CreateIndex
CREATE INDEX "SyncRun_dataSourceId_startedAt_idx" ON "SyncRun"("dataSourceId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_key_key" ON "Alert"("key");

-- CreateIndex
CREATE INDEX "Alert_departmentId_resolvedAt_idx" ON "Alert"("departmentId", "resolvedAt");

-- CreateIndex
CREATE INDEX "AuditLog_departmentId_createdAt_idx" ON "AuditLog"("departmentId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiDefinition" ADD CONSTRAINT "KpiDefinition_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiDefinition" ADD CONSTRAINT "KpiDefinition_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiTarget" ADD CONSTRAINT "KpiTarget_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "KpiDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiSubmission" ADD CONSTRAINT "KpiSubmission_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "KpiDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiSubmission" ADD CONSTRAINT "KpiSubmission_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiSubmission" ADD CONSTRAINT "KpiSubmission_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiResult" ADD CONSTRAINT "KpiResult_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "KpiDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KpiResult" ADD CONSTRAINT "KpiResult_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "KpiSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Application audit records are append-only, including for runtime writes.
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'AuditLog is append-only'; END;
$$;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
ALTER TABLE "KpiResult" ADD CONSTRAINT result_dates_valid CHECK ("periodEnd" >= "periodStart");
ALTER TABLE "KpiSubmission" ADD CONSTRAINT submission_dates_valid CHECK ("periodEnd" >= "periodStart");
