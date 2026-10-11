import type { ApiClient } from "@/api/client";

/**
 * Today in Bikram Sambat, from the clock, for a home that has neither registers nor a daily log to read it from (a school
 * with both switched off, D-139). Null if it cannot be worked out: the greeting then simply has no date.
 */
export async function nepalToday(api: ApiClient): Promise<string | null> {
  try {
    const ad = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kathmandu" }).format(new Date());
    const { data } = await api.GET("/api/dates/to-bs", { params: { query: { ad } } });
    return data?.text ?? null;
  } catch {
    return null;
  }
}
