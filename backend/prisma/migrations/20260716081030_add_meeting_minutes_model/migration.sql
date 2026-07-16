-- CreateTable
CREATE TABLE "MeetingMinutes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "meetingDate" TIMESTAMP(3) NOT NULL,
    "attendeeMembershipIds" JSONB NOT NULL,
    "agendaItems" JSONB NOT NULL,
    "actionItems" JSONB NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingMinutes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeetingMinutes_organizationId_idx" ON "MeetingMinutes"("organizationId");

-- AddForeignKey
ALTER TABLE "MeetingMinutes" ADD CONSTRAINT "MeetingMinutes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
