-- CreateTable
CREATE TABLE `AdminUser` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `passwordHash` VARCHAR(100) NOT NULL,
    `role` ENUM('ADMIN', 'VIEWER') NOT NULL DEFAULT 'ADMIN',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AdminUser_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Application` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(500) NULL,
    `iconUrl` VARCHAR(500) NULL,
    `isVip` BOOLEAN NOT NULL DEFAULT false,
    `serviceValidUntil` DATETIME(3) NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Application_status_idx`(`status`),
    INDEX `Application_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppEnvironment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `applicationId` INTEGER NOT NULL,
    `type` ENUM('PRODUCTION', 'TESTING') NOT NULL,
    `appKey` VARCHAR(40) NOT NULL,
    `callbackUrl` VARCHAR(500) NULL,
    `callbackEnabled` BOOLEAN NOT NULL DEFAULT false,
    `ipAllowlist` JSON NOT NULL,
    `enabledChannels` JSON NOT NULL,
    `simulatorConfig` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AppEnvironment_appKey_key`(`appKey`),
    UNIQUE INDEX `AppEnvironment_applicationId_type_key`(`applicationId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AppCredential` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `environmentId` INTEGER NOT NULL,
    `secretHash` VARCHAR(64) NOT NULL,
    `secretHint` VARCHAR(8) NOT NULL,
    `status` ENUM('ACTIVE', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `AppCredential_secretHash_key`(`secretHash`),
    INDEX `AppCredential_environmentId_status_idx`(`environmentId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Device` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `environmentId` INTEGER NOT NULL,
    `registrationId` VARCHAR(64) NOT NULL,
    `platform` ENUM('ANDROID', 'IOS', 'HARMONYOS') NOT NULL,
    `vendor` VARCHAR(32) NULL,
    `model` VARCHAR(64) NULL,
    `osVersion` VARCHAR(32) NULL,
    `appVersion` VARCHAR(32) NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `online` BOOLEAN NOT NULL DEFAULT false,
    `lastActiveAt` DATETIME(3) NULL,
    `aliasId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Device_registrationId_key`(`registrationId`),
    INDEX `Device_environmentId_platform_idx`(`environmentId`, `platform`),
    INDEX `Device_environmentId_status_idx`(`environmentId`, `status`),
    INDEX `Device_environmentId_lastActiveAt_idx`(`environmentId`, `lastActiveAt`),
    INDEX `Device_aliasId_idx`(`aliasId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tag` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `environmentId` INTEGER NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Tag_environmentId_name_key`(`environmentId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeviceTag` (
    `deviceId` INTEGER NOT NULL,
    `tagId` INTEGER NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DeviceTag_tagId_idx`(`tagId`),
    PRIMARY KEY (`deviceId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Alias` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `environmentId` INTEGER NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Alias_environmentId_name_key`(`environmentId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PushMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `msgid` VARCHAR(32) NOT NULL,
    `environmentId` INTEGER NOT NULL,
    `type` ENUM('NOTIFICATION', 'CUSTOM', 'IN_APP') NOT NULL,
    `title` VARCHAR(200) NULL,
    `body` TEXT NULL,
    `style` ENUM('DEFAULT', 'THUMBNAIL', 'BIG_PICTURE', 'TEXT', 'INBOX', 'CUSTOM') NOT NULL DEFAULT 'DEFAULT',
    `styleConfig` JSON NULL,
    `customPayload` JSON NULL,
    `platforms` JSON NOT NULL,
    `audienceType` ENUM('ALL', 'REGISTRATION_IDS', 'TAGS', 'ALIASES') NOT NULL,
    `audience` JSON NOT NULL,
    `strategy` ENUM('mtpush', 'fcm_mtpush', 'pns_mtpush', 'mtpush_fcm', 'mtpush_pns') NOT NULL,
    `scheduleType` ENUM('IMMEDIATE', 'SCHEDULED') NOT NULL DEFAULT 'IMMEDIATE',
    `scheduledAt` DATETIME(3) NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `failureReason` VARCHAR(255) NULL,
    `isSimulated` BOOLEAN NOT NULL DEFAULT true,
    `idempotencyKey` VARCHAR(128) NULL,
    `requestHash` VARCHAR(64) NOT NULL,
    `createdById` INTEGER NULL,
    `dispatchedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PushMessage_msgid_key`(`msgid`),
    INDEX `PushMessage_environmentId_createdAt_idx`(`environmentId`, `createdAt`),
    INDEX `PushMessage_environmentId_status_idx`(`environmentId`, `status`),
    INDEX `PushMessage_environmentId_dispatchedAt_idx`(`environmentId`, `dispatchedAt`),
    UNIQUE INDEX `PushMessage_environmentId_idempotencyKey_key`(`environmentId`, `idempotencyKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageTarget` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `messageId` INTEGER NOT NULL,
    `deviceId` INTEGER NULL,
    `registrationId` VARCHAR(80) NOT NULL,
    `platform` ENUM('ANDROID', 'IOS', 'HARMONYOS') NULL,
    `vendor` VARCHAR(32) NULL,
    `appVersion` VARCHAR(32) NULL,
    `online` BOOLEAN NOT NULL DEFAULT false,
    `isValid` BOOLEAN NOT NULL,
    `invalidReason` VARCHAR(64) NULL,
    `status` ENUM('PENDING', 'INVALID', 'SENT', 'DELIVERED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `finalChannel` VARCHAR(16) NULL,
    `failureReason` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MessageTarget_messageId_status_idx`(`messageId`, `status`),
    INDEX `MessageTarget_deviceId_idx`(`deviceId`),
    UNIQUE INDEX `MessageTarget_messageId_registrationId_key`(`messageId`, `registrationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DeliveryAttempt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `targetId` INTEGER NOT NULL,
    `attemptNo` INTEGER NOT NULL,
    `channel` VARCHAR(16) NOT NULL,
    `provider` VARCHAR(64) NOT NULL,
    `isFallback` BOOLEAN NOT NULL DEFAULT false,
    `isSimulated` BOOLEAN NOT NULL DEFAULT true,
    `outcome` ENUM('DELIVERED', 'ACCEPTED', 'FAILED', 'SKIPPED') NOT NULL,
    `failureReason` VARCHAR(255) NULL,
    `providerMessageId` VARCHAR(64) NULL,
    `attemptedAt` DATETIME(3) NOT NULL,

    INDEX `DeliveryAttempt_channel_outcome_idx`(`channel`, `outcome`),
    UNIQUE INDEX `DeliveryAttempt_targetId_attemptNo_key`(`targetId`, `attemptNo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `targetId` INTEGER NOT NULL,
    `type` ENUM('SENT', 'DELIVERED', 'DISPLAYED', 'CLICKED') NOT NULL,
    `source` ENUM('DELIVERY_SIMULATOR', 'MANUAL_SIMULATION') NOT NULL,
    `channel` VARCHAR(16) NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MessageEvent_type_occurredAt_idx`(`type`, `occurredAt`),
    UNIQUE INDEX `MessageEvent_targetId_type_key`(`targetId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScheduledJob` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `messageId` INTEGER NOT NULL,
    `runAt` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `lockedBy` VARCHAR(64) NULL,
    `lockedAt` DATETIME(3) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `maxAttempts` INTEGER NOT NULL DEFAULT 3,
    `lastError` VARCHAR(500) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ScheduledJob_messageId_key`(`messageId`),
    INDEX `ScheduledJob_status_runAt_idx`(`status`, `runAt`),
    INDEX `ScheduledJob_status_lockedAt_idx`(`status`, `lockedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkerHeartbeat` (
    `workerId` VARCHAR(64) NOT NULL,
    `lastBeatAt` DATETIME(3) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`workerId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actorUserId` INTEGER NULL,
    `actorLabel` VARCHAR(191) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `entityType` VARCHAR(32) NOT NULL,
    `entityId` VARCHAR(64) NOT NULL,
    `metadata` JSON NULL,
    `ipAddress` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `AppEnvironment` ADD CONSTRAINT `AppEnvironment_applicationId_fkey` FOREIGN KEY (`applicationId`) REFERENCES `Application`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AppCredential` ADD CONSTRAINT `AppCredential_environmentId_fkey` FOREIGN KEY (`environmentId`) REFERENCES `AppEnvironment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Device` ADD CONSTRAINT `Device_environmentId_fkey` FOREIGN KEY (`environmentId`) REFERENCES `AppEnvironment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Device` ADD CONSTRAINT `Device_aliasId_fkey` FOREIGN KEY (`aliasId`) REFERENCES `Alias`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Tag` ADD CONSTRAINT `Tag_environmentId_fkey` FOREIGN KEY (`environmentId`) REFERENCES `AppEnvironment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeviceTag` ADD CONSTRAINT `DeviceTag_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeviceTag` ADD CONSTRAINT `DeviceTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Alias` ADD CONSTRAINT `Alias_environmentId_fkey` FOREIGN KEY (`environmentId`) REFERENCES `AppEnvironment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushMessage` ADD CONSTRAINT `PushMessage_environmentId_fkey` FOREIGN KEY (`environmentId`) REFERENCES `AppEnvironment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageTarget` ADD CONSTRAINT `MessageTarget_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `PushMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageTarget` ADD CONSTRAINT `MessageTarget_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DeliveryAttempt` ADD CONSTRAINT `DeliveryAttempt_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `MessageTarget`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageEvent` ADD CONSTRAINT `MessageEvent_targetId_fkey` FOREIGN KEY (`targetId`) REFERENCES `MessageTarget`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScheduledJob` ADD CONSTRAINT `ScheduledJob_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `PushMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `AdminUser`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
