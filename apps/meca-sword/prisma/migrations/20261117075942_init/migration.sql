-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('pending', 'active', 'blocked');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('member', 'admin');

-- CreateTable
CREATE TABLE "User" (
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'pending',
    "role" "UserRole" NOT NULL DEFAULT 'member',
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "depositedBy" TEXT,
    "collection" TEXT,
    "state" TEXT NOT NULL,
    "title" TEXT,
    "record" JSONB NOT NULL,

    CONSTRAINT "Deposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,
    "title" TEXT,
    "authors" TEXT,
    "doi" TEXT,
    "size" INTEGER NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "built" BOOLEAN NOT NULL,
    "notes" TEXT[],
    "warnings" TEXT[],

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Destination" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serviceUrl" TEXT NOT NULL,
    "username" TEXT,
    "secret" TEXT,
    "secretKind" TEXT,
    "collections" JSONB NOT NULL DEFAULT '[]',
    "maxUploadSize" INTEGER,
    "acceptsMeca" BOOLEAN,
    "checkedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Destination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentDeposit" (
    "id" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentBy" TEXT NOT NULL,
    "packageId" TEXT,
    "filename" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "title" TEXT,
    "destinationId" TEXT,
    "destination" TEXT NOT NULL,
    "collection" TEXT,
    "serviceUrl" TEXT NOT NULL,
    "objectUrl" TEXT,
    "state" TEXT,
    "stateDescription" TEXT,
    "checkedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "SentDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");

-- CreateIndex
CREATE INDEX "ApiKey_ownerEmail_idx" ON "ApiKey"("ownerEmail");

-- CreateIndex
CREATE INDEX "Deposit_createdAt_idx" ON "Deposit"("createdAt");

-- CreateIndex
CREATE INDEX "Deposit_depositedBy_idx" ON "Deposit"("depositedBy");

-- CreateIndex
CREATE UNIQUE INDEX "Destination_serviceUrl_key" ON "Destination"("serviceUrl");

-- CreateIndex
CREATE INDEX "SentDeposit_sentAt_idx" ON "SentDeposit"("sentAt");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_ownerEmail_fkey" FOREIGN KEY ("ownerEmail") REFERENCES "User"("email") ON DELETE CASCADE ON UPDATE CASCADE;
