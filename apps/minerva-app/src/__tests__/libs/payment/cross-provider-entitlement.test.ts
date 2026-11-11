import { describe, it, expect, vi, beforeEach } from 'vitest';

// `plans.plan` is written by the Google Play AND the App Store IAP handlers.
// Each one used to look only at its own provider, so whichever provider
// transitioned last won: an expiry on one store wiped the plan of a user who
// had subscribed on the other. A paying Pro user was dropped to `free` —
// 500 MB of storage — until some unrelated event happened to rewrite the row.
//
// The plan written must reflect the highest plan the user is entitled to across
// EVERY billing provider, regardless of which one fired the event.

const db = vi.hoisted(() => ({
  planUpdates: [] as Array<Record<string, unknown>>,
  google: [] as Array<{ product_id: string; status: string }>,
  apple: [] as Array<{ product_id: string; status: string }>,
}));

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table === 'plans') {
        return {
          update: (values: Record<string, unknown>) => ({
            eq: () => {
              db.planUpdates.push(values);
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      if (table === 'google_iap_subscriptions') {
        return {
          select: () => ({
            eq: () => ({
              in: (_col: string, statuses: string[]) =>
                Promise.resolve({
                  data: db.google.filter((r) => statuses.includes(r.status)),
                  error: null,
                }),
              single: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          upsert: () => Promise.resolve({ data: null, error: null }),
        };
      }
      if (table === 'apple_iap_subscriptions') {
        return {
          select: () => ({
            eq: () => ({
              in: (_col: string, statuses: string[]) =>
                Promise.resolve({
                  data: db.apple.filter((r) => statuses.includes(r.status)),
                  error: null,
                }),
              single: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          upsert: () => Promise.resolve({ data: null, error: null }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { resolveUserPlan } from '@/libs/payment/entitlements';

const PRO_PLAY_SKU = 'com.minerva.app.monthly.pro';
const PLUS_PLAY_SKU = 'com.minerva.app.monthly.plus';
const PRO_APPLE_SKU = 'com.minerva.app.monthly.pro';

beforeEach(() => {
  db.planUpdates = [];
  db.google = [];
  db.apple = [];
});

describe('resolveUserPlan', () => {
  it('keeps Pro when the App Store entitlement is the surviving one', async () => {
    db.apple = [{ product_id: PRO_APPLE_SKU, status: 'active' }];

    expect(await resolveUserPlan('user-1')).toBe('pro');
  });

  it('keeps Pro when Google Play is still active', async () => {
    db.google = [{ product_id: PRO_PLAY_SKU, status: 'active' }];

    expect(await resolveUserPlan('user-1')).toBe('pro');
  });

  it('returns the highest plan when the stores disagree', async () => {
    db.google = [{ product_id: PLUS_PLAY_SKU, status: 'active' }];
    db.apple = [{ product_id: PRO_APPLE_SKU, status: 'active' }];

    expect(await resolveUserPlan('user-1')).toBe('pro');
  });

  it('honours an entitledPlan the stored rows cannot express (billing grace period)', async () => {
    // The IAP tables collapse status to active/expired, so a subscription in
    // its billing grace period is stored as `expired`. The handler processing
    // that event passes the entitlement it knows about instead.
    db.google = [{ product_id: PLUS_PLAY_SKU, status: 'expired' }];

    expect(await resolveUserPlan('user-1', { entitledPlan: 'plus' })).toBe('plus');
  });

  it('returns free only when no store entitles anything', async () => {
    db.google = [{ product_id: PRO_PLAY_SKU, status: 'expired' }];
    db.apple = [{ product_id: PRO_APPLE_SKU, status: 'revoked' }];

    expect(await resolveUserPlan('user-1')).toBe('free');
  });
});
