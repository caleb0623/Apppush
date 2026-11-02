-- AlterTable
ALTER TABLE `DeliveryAttempt` ADD COLUMN `providerResponse` JSON NULL,
    MODIFY `providerMessageId` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `Device` ADD COLUMN `deviceSecretHash` VARCHAR(64) NULL,
    ADD COLUMN `installationId` VARCHAR(64) NULL,
    ADD COLUMN `pushToken` VARCHAR(512) NULL,
    ADD COLUMN `pushTokenStatus` ENUM('ACTIVE', 'INVALID') NULL,
    ADD COLUMN `pushTokenUpdatedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `MessageEvent` ADD COLUMN `inferred` BOOLEAN NOT NULL DEFAULT false,
    MODIFY `source` ENUM('DELIVERY_SIMULATOR', 'MANUAL_SIMULATION', 'PROVIDER', 'DEVICE_CLIENT') NOT NULL;

-- AlterTable
ALTER TABLE `MessageTarget` ADD COLUMN `deliveryMode` ENUM('REAL', 'SIMULATED') NOT NULL DEFAULT 'SIMULATED';

-- AlterTable
ALTER TABLE `PushMessage` ADD COLUMN `channelOverride` VARCHAR(16) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Device_environmentId_installationId_key` ON `Device`(`environmentId`, `installationId`);

-- CreateIndex
CREATE UNIQUE INDEX `Device_environmentId_pushToken_key` ON `Device`(`environmentId`, `pushToken`);
