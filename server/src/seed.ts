import { prisma } from "./lib/prisma.js";
import { hashPassword } from "./lib/password.js";

/**
 * Minimal seed to bootstrap PepperNet for local development:
 *   - one outlet (Colombo 01)
 *   - one SUPER_ADMIN assigned to it
 * Run with: `npm run seed`
 */
async function main() {
  const outlet = await prisma.outlet.upsert({
    where: { code: "COL01" },
    update: {},
    create: {
      name: "PepperNet — Colombo 01",
      code: "COL01",
      city: "Colombo",
      currency: "LKR",
      taxRate: 0,
      serviceCharge: 0,
    },
  });

  const email = "admin@peppernet.lk";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const passwordHash = await hashPassword("ChangeMe123!");
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName: "PepperNet Admin",
        role: "SUPER_ADMIN",
        outletAssignments: { create: { outletId: outlet.id } },
      },
    });
    console.log(`[PepperNet] Seeded SUPER_ADMIN ${email} / ChangeMe123!`);
  } else {
    console.log("[PepperNet] Admin already exists, skipping.");
  }

  console.log(`[PepperNet] Outlet ready: ${outlet.name} (${outlet.code})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
