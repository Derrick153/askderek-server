/*
  Warnings:

  - You are about to drop the column `tenantCognitoId` on the `Application` table. All the data in the column will be lost.
  - You are about to drop the column `tenantCognitoId` on the `Lease` table. All the data in the column will be lost.
  - You are about to drop the column `cognitoId` on the `Manager` table. All the data in the column will be lost.
  - You are about to drop the column `managerCognitoId` on the `Property` table. All the data in the column will be lost.
  - You are about to drop the column `cognitoId` on the `Tenant` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[clerkId]` on the table `Manager` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[clerkId]` on the table `Tenant` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `tenantClerkId` to the `Application` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantClerkId` to the `Lease` table without a default value. This is not possible if the table is not empty.
  - Added the required column `clerkId` to the `Manager` table without a default value. This is not possible if the table is not empty.
  - Added the required column `managerClerkId` to the `Property` table without a default value. This is not possible if the table is not empty.
  - Added the required column `clerkId` to the `Tenant` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_tenantCognitoId_fkey";

-- DropForeignKey
ALTER TABLE "Lease" DROP CONSTRAINT "Lease_tenantCognitoId_fkey";

-- DropForeignKey
ALTER TABLE "Property" DROP CONSTRAINT "Property_managerCognitoId_fkey";

-- DropIndex
DROP INDEX "Manager_cognitoId_key";

-- DropIndex
DROP INDEX "Tenant_cognitoId_key";

-- AlterTable
ALTER TABLE "Application" DROP COLUMN "tenantCognitoId",
ADD COLUMN     "tenantClerkId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Lease" DROP COLUMN "tenantCognitoId",
ADD COLUMN     "tenantClerkId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Manager" DROP COLUMN "cognitoId",
ADD COLUMN     "clerkId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Property" DROP COLUMN "managerCognitoId",
ADD COLUMN     "managerClerkId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Tenant" DROP COLUMN "cognitoId",
ADD COLUMN     "clerkId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Manager_clerkId_key" ON "Manager"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_clerkId_key" ON "Tenant"("clerkId");

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_managerClerkId_fkey" FOREIGN KEY ("managerClerkId") REFERENCES "Manager"("clerkId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_tenantClerkId_fkey" FOREIGN KEY ("tenantClerkId") REFERENCES "Tenant"("clerkId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lease" ADD CONSTRAINT "Lease_tenantClerkId_fkey" FOREIGN KEY ("tenantClerkId") REFERENCES "Tenant"("clerkId") ON DELETE RESTRICT ON UPDATE CASCADE;
