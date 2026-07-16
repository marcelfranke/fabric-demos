import { v5 as uuidv5 } from 'uuid';

import type { Program } from '../../../rayfin/data/schema';
import { getRayfinClient } from '../../services/rayfinClient';

import { PROGRAM_NAMESPACE_UUID, PROGRAM_SEEDS, type ProductCode } from './constants';

/** Deterministic Program id for a product code, so seeded + synced rows agree. */
export function programId(code: ProductCode): string {
  return uuidv5(code, PROGRAM_NAMESPACE_UUID);
}

/**
 * Ensure the three PMI Programs (IQOS / ZYN / VEEV) exist with deterministic
 * ids. Idempotent and race-safe (deterministic ids converge). Bypasses the
 * DataService write-gate on purpose: both the seeded flow and the CDC sync flow
 * need the programs present regardless of sync mode.
 */
export async function ensurePrograms(): Promise<Record<ProductCode, Program>> {
  const client = getRayfinClient();
  const out = {} as Record<ProductCode, Program>;
  for (const seed of PROGRAM_SEEDS) {
    const id = programId(seed.product_code);
    const existing = await client.data.Program.findById(id);
    if (existing) {
      out[seed.product_code] = existing;
      continue;
    }
    try {
      out[seed.product_code] = await client.data.Program.create({
        id,
        name: seed.name,
        description: seed.description,
        product_code: seed.product_code,
        created_at: new Date(),
      });
    } catch {
      const refetched = await client.data.Program.findById(id);
      if (!refetched)
        throw new Error(`Failed to create or load program ${seed.product_code}`);
      out[seed.product_code] = refetched;
    }
  }
  return out;
}
