-- CreateTable
CREATE TABLE "SupportAssistantFeedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT,
    "mode" TEXT NOT NULL,
    "vertical" TEXT,
    "currentPath" TEXT,
    "questionCategory" TEXT NOT NULL,
    "helpful" BOOLEAN,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportAssistantFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupportAssistantFeedback_organizationId_createdAt_idx" ON "SupportAssistantFeedback"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportAssistantFeedback_questionCategory_idx" ON "SupportAssistantFeedback"("questionCategory");

-- AddForeignKey
ALTER TABLE "SupportAssistantFeedback" ADD CONSTRAINT "SupportAssistantFeedback_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportAssistantFeedback" ADD CONSTRAINT "SupportAssistantFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
