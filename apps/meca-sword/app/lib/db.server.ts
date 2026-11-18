import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { getConfig } from './config.server';

let client: Promise<PrismaClient> | undefined;

/** One Prisma client per server instance, on `database.url` (Supabase's pooler when deployed) */
export function db(): Promise<PrismaClient> {
  client ??= getConfig().then(
    (config) =>
      new PrismaClient({ adapter: new PrismaPg({ connectionString: config.database.url }) }),
  );
  return client;
}
