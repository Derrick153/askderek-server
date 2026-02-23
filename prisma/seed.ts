import { PrismaClient, Prisma } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toPascalCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function toCamelCase(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

// ✨ FIXED: Transform data to match Prisma schema requirements
function transformDataForClerk(modelName: string, item: any): any {
  const transformed = { ...item };

  // Manager: cognitoId → clerkId (keep existing logic)
  if (modelName === "Manager" && item.cognitoId) {
    transformed.clerkId = `clerk_manager_${item.id}`;
    delete transformed.cognitoId;
  }

  // Tenant: clerkUserId → clerkId (FIX for missing clerkId error)
  if (modelName === "Tenant") {
    if (item.clerkUserId) {
      transformed.clerkId = item.clerkUserId;
      delete transformed.clerkUserId;
    }
    if (item.cognitoId) {
      transformed.clerkId = `clerk_tenant_${item.id}`;
      delete transformed.cognitoId;
    }
  }

  // Property: managerId → managerClerkId (keep existing logic)
  if (modelName === "Property" && item.managerId) {
    transformed.managerClerkId = `clerk_manager_${item.managerId}`;
    delete transformed.managerId;
  }

  // Lease: Map securityDeposit → deposit AND rentPerMonth → rent (if they exist)
  if (modelName === "Lease") {
    // Map securityDeposit to deposit
    if (item.securityDeposit !== undefined) {
      transformed.deposit = item.securityDeposit;
      delete transformed.securityDeposit;
    }
    
    // Map rentPerMonth to rent
    if (item.rentPerMonth !== undefined) {
      transformed.rent = item.rentPerMonth;
      delete transformed.rentPerMonth;
    }
    
    // Handle tenant clerk ID mapping
    if (item.tenantCognitoId) {
      const tenantId = item.tenantId || 1;
      transformed.tenantClerkId = `clerk_tenant_${tenantId}`;
      delete transformed.tenantCognitoId;
      delete transformed.tenantId;
    }
  }

  // Application: tenantCognitoId → tenantClerkId (keep existing logic)
  if (modelName === "Application" && item.tenantCognitoId) {
    const tenantId = item.tenantId || 1;
    transformed.tenantClerkId = `clerk_tenant_${tenantId}`;
    delete transformed.tenantCognitoId;
    delete transformed.tenantId;
  }

  return transformed;
}

async function insertLocationData(locations: any[]) {
  for (const location of locations) {
    const { id, country, city, state, address, postalCode, coordinates } =
      location;
    try {
      await prisma.$executeRaw`
        INSERT INTO "Location" ("id", "country", "city", "state", "address", "postalCode", "coordinates") 
        VALUES (${id}, ${country}, ${city}, ${state}, ${address}, ${postalCode}, ST_GeomFromText(${coordinates}, 4326));
      `;
      console.log(`Inserted location for ${city}`);
    } catch (error) {
      console.error(`Error inserting location for ${city}:`, error);
    }
  }
}

async function resetSequence(modelName: string) {
  const quotedModelName = `"${toPascalCase(modelName)}"`;

  const maxIdResult = await (
    prisma[modelName as keyof PrismaClient] as any
  ).findMany({
    select: { id: true },
    orderBy: { id: "desc" },
    take: 1,
  });

  if (maxIdResult.length === 0) return;

  const nextId = maxIdResult[0].id + 1;
  
  const query = `
    SELECT setval(
      pg_get_serial_sequence('${quotedModelName}', 'id'), 
      COALESCE((SELECT MAX(id) FROM ${quotedModelName}) + 1, ${nextId}), 
      false
    );
  `;
  
  await prisma.$executeRawUnsafe(query);
  console.log(`Reset sequence for ${modelName} to ${nextId}`);
}

async function deleteAllData(orderedFileNames: string[]) {
  const modelNames = orderedFileNames.map((fileName) => {
    return toPascalCase(path.basename(fileName, path.extname(fileName)));
  });

  for (const modelName of modelNames.reverse()) {
    const modelNameCamel = toCamelCase(modelName);
    const model = (prisma as any)[modelNameCamel];
    if (!model) {
      console.error(`Model ${modelName} not found in Prisma client`);
      continue;
    }
    try {
      await model.deleteMany({});
      console.log(`Cleared data from ${modelName}`);
    } catch (error) {
      console.error(`Error clearing data from ${modelName}:`, error);
    }
  }
}

async function main() {
  const dataDirectory = path.join(__dirname, "seedData");

  const orderedFileNames = [
    "location.json",
    "manager.json",
    "property.json",
    "tenant.json",
    "lease.json",
    "application.json",
    "payment.json",
  ];

  await deleteAllData(orderedFileNames);

  for (const fileName of orderedFileNames) {
    const filePath = path.join(dataDirectory, fileName);
    const jsonData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const modelName = toPascalCase(
      path.basename(fileName, path.extname(fileName))
    );
    const modelNameCamel = toCamelCase(modelName);

    if (modelName === "Location") {
      await insertLocationData(jsonData);
    } else {
      const model = (prisma as any)[modelNameCamel];
      try {
        for (const item of jsonData) {
          // ✨ Transform the data before inserting
          const transformedItem = transformDataForClerk(modelName, item);
          
          await model.create({
            data: transformedItem,
          });
        }
        console.log(`Seeded ${modelName} with data from ${fileName}`);
      } catch (error) {
        console.error(`Error seeding data for ${modelName}:`, error);
      }
    }

    await resetSequence(modelNameCamel);
    await sleep(1000);
  }
}

main()
  .catch((e) => console.error(e))
  .finally(async () => await prisma.$disconnect());