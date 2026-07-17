-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "requireFeedbackForCertificate" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FeedbackResponse" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "npsScore" INTEGER NOT NULL,
    "contentRating" INTEGER NOT NULL,
    "organizationRating" INTEGER NOT NULL,
    "venueRating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedbackResponse_organizationId_idx" ON "FeedbackResponse"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackResponse_eventId_userId_key" ON "FeedbackResponse"("eventId", "userId");

-- AddForeignKey
ALTER TABLE "FeedbackResponse" ADD CONSTRAINT "FeedbackResponse_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackResponse" ADD CONSTRAINT "FeedbackResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
