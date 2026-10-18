import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppSettings = {
  site_name: string;
  contact_email: string;
  contact_phone: string;
  vat_percent: number;
  invoice_prefix: string;
  order_auto_reject_days: number;
  maintenance_mode: boolean;
  maintenance_message: string;
  usdt_to_bdt_rate: number;
};

const DEFAULTS: AppSettings = {
  site_name: "OneClick Studio",
  contact_email: "",
  contact_phone: "",
  vat_percent: 0,
  invoice_prefix: "INV",
  order_auto_reject_days: 7,
  maintenance_mode: false,
  maintenance_message: "",
  usdt_to_bdt_rate: 126,
};

const KEY = ["app_settings"] as const;

// Single-row settings table. TanStack-Query backed so all consumers share one fetch + cache.
export const useAppSettings = () => {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<AppSettings> => {
      const { data } = await supabase.from("app_settings").select("*").eq("id", true).maybeSingle();
      return { ...DEFAULTS, ...((data ?? {}) as Partial<AppSettings>) };
    },
    staleTime: 5 * 60_000,
  });

  const update = async (patch: Partial<AppSettings>) => {
    const { error } = await supabase.from("app_settings").update(patch).eq("id", true);
    if (error) throw error;
    qc.setQueryData<AppSettings>(KEY, (s) => ({ ...(s ?? DEFAULTS), ...patch }));
  };

  return {
    settings: query.data ?? DEFAULTS,
    loading: query.isLoading,
    refresh: () => qc.invalidateQueries({ queryKey: KEY }),
    update,
  };
};
