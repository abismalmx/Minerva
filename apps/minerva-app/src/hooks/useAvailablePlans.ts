import { useEffect, useState } from 'react';
import { fetchAndTransformIAPPlans, isIAPAvailable } from '@/libs/payment/iap/client';
import { AvailablePlan } from '@/types/quota';
import { stubTranslation as _ } from '@/utils/misc';

const IAP_PRODUCT_IDS = [
  'com.minerva.app.monthly.plus',
  'com.minerva.app.monthly.pro',
  'com.minerva.app.yearly.plus',
  'com.minerva.app.yearly.pro',
  'com.minerva.app.storage.1gb.purchase',
  'com.minerva.app.storage.2gb.purchase',
  'com.minerva.app.storage.5gb.purchase',
  'com.minerva.app.storage.10gb.purchase',
  'com.minerva.app.customization.purchase',
];

interface UseAvailablePlansParams {
  hasIAP: boolean;
  onError?: (message: string) => void;
}

export const useAvailablePlans = ({ hasIAP, onError }: UseAvailablePlansParams) => {
  const [availablePlans, setAvailablePlans] = useState<AvailablePlan[]>([]);
  const [iapAvailable, setIapAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchPlans = async () => {
      setLoading(true);
      setError(null);

      try {
        if (hasIAP && (await isIAPAvailable())) {
          const plans = await fetchAndTransformIAPPlans(IAP_PRODUCT_IDS);
          setAvailablePlans(plans);
          setIapAvailable(true);
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Unknown error');
        setError(error);
        console.error('Failed to fetch IAP plans:', error);

        if (onError) {
          onError(_('Failed to load subscription plans.'));
        }
      } finally {
        setLoading(false);
      }
    };

    fetchPlans();
  }, [hasIAP, onError]);

  return { availablePlans, iapAvailable, loading, error };
};
