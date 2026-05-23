// prisma/seed-platform-config.ts
// ============================================================
// Seeds the platform_config table with default operational
// settings for subscription lifecycle management.
//
// Run with: npx ts-node prisma/seed-platform-config.ts
//
// Safe to run multiple times — uses upsert, never overwrites
// values that super admin has already customized.
// ============================================================
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CONFIGS = [
  {
    key:         'subscription.abandoned_after_days',
    value:       '60',
    valueType:   'number',
    label:       'Abandoned After (Days)',
    description: 'Number of days a subscription must be SUSPENDED before it is automatically marked as EXPIRED (abandoned). Minimum: 1. Default: 60.',
  },
];

async function main() {
  console.log('🌱 Seeding platform config...\n');

  for (const config of CONFIGS) {
    const existing = await prisma.platformConfig.findUnique({
      where: { key: config.key },
    });

    if (existing) {
      // Update label/description only — never overwrite a value the super admin has set
      await prisma.platformConfig.update({
        where: { key: config.key },
        data: {
          label:       config.label,
          description: config.description,
          valueType:   config.valueType,
        },
      });
      console.log(`✓ Already exists (value preserved): ${config.key} = ${existing.value}`);
    } else {
      await prisma.platformConfig.create({ data: config });
      console.log(`✓ Created: ${config.key} = ${config.value}`);
    }
  }

  console.log('\n✅ Platform config seeded');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
