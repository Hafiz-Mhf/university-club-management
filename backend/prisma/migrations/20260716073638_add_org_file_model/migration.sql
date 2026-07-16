-- CreateEnum
CREATE TYPE "FileCategory" AS ENUM ('SOP', 'REPORT', 'FINANCIAL', 'MEETING', 'OTHER');

-- CreateTable
CREATE TABLE "OrgFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "FileCategory" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgFile_organizationId_idx" ON "OrgFile"("organizationId");

-- CreateIndex
CREATE INDEX "OrgFile_organizationId_category_idx" ON "OrgFile"("organizationId", "category");

-- AddForeignKey
ALTER TABLE "OrgFile" ADD CONSTRAINT "OrgFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
