import type { D1Database } from '@cloudflare/workers-types';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

import * as schema from './schema';

export { schema };

/** The Drizzle client bound to a request's D1 database. */
export type DB = DrizzleD1Database<typeof schema>;

export const getDb = (d1: D1Database): DB => drizzle(d1, { schema });
