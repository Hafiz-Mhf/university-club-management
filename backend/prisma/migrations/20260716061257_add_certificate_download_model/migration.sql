-- CreateTable
CREATE TABLE "CertificateDownload" (
    "id" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CertificateDownload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CertificateDownload_certificateId_idx" ON "CertificateDownload"("certificateId");

-- AddForeignKey
ALTER TABLE "CertificateDownload" ADD CONSTRAINT "CertificateDownload_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "Certificate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
