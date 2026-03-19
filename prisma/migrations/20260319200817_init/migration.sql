-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "groupName" TEXT NOT NULL,
    "sicCode" TEXT,
    "state" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ClientSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "groupName" TEXT NOT NULL,
    "totalEmployees" INTEGER,
    "totalMembers" INTEGER,
    "effectiveDate" TEXT,
    "renewalDate" TEXT,
    "sicCode" TEXT,
    "state" TEXT,
    "metadata" TEXT,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientSnapshot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BenefitPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientSnapshotId" TEXT NOT NULL,
    "planType" TEXT NOT NULL,
    "carrier" TEXT,
    "planName" TEXT,
    "enrollees" INTEGER,
    "premium" REAL,
    "metadata" TEXT,
    CONSTRAINT "BenefitPlan_clientSnapshotId_fkey" FOREIGN KEY ("clientSnapshotId") REFERENCES "ClientSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmployeeSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientSnapshotId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TEXT,
    "hireDate" TEXT,
    "termDate" TEXT,
    "status" TEXT,
    "coverageTier" TEXT,
    "metadata" TEXT,
    CONSTRAINT "EmployeeSnapshot_clientSnapshotId_fkey" FOREIGN KEY ("clientSnapshotId") REFERENCES "ClientSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_groupId_key" ON "Client"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSnapshot_clientId_year_key" ON "ClientSnapshot"("clientId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeSnapshot_clientSnapshotId_employeeId_key" ON "EmployeeSnapshot"("clientSnapshotId", "employeeId");
