import { supabase } from "@/lib/supabase";
import { describeDbError } from "@/lib/errors";

export type InvoiceStatus = "draft" | "issued" | "paid" | "cancelled";

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "טיוטה",
  issued: "נשלחה",
  paid: "שולמה",
  cancelled: "בוטלה",
};

export type InvoiceLine = {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  position: number;
};

export type Invoice = {
  id: string;
  number: number;
  status: InvoiceStatus;
  subtotal: number;
  vat_rate: number;
  vat: number;
  total: number;
  issued_at: string | null;
  due_date: string | null;
  paid_at: string | null;
  external_invoice_id: string | null;
  external_url: string | null;
  created_at: string;
};

const SELECT =
  "id, number, status, subtotal, vat_rate, vat, total, issued_at, due_date, paid_at, external_invoice_id, external_url, created_at";

export async function listInvoices(matterId: string): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from("invoices")
    .select(SELECT)
    .eq("matter_id", matterId)
    .order("number", { ascending: false });
  if (error) throw new Error(describeDbError(error));
  return data ?? [];
}

export async function listInvoiceLines(invoiceId: string): Promise<InvoiceLine[]> {
  const { data, error } = await supabase
    .from("invoice_lines")
    .select("id, description, quantity, unit_price, amount, position")
    .eq("invoice_id", invoiceId)
    .order("position", { ascending: true });
  if (error) throw new Error(describeDbError(error));
  return data ?? [];
}

const ASSEMBLY_TROUBLE: Record<string, string> = {
  NOTHING_TO_BILL: "אין שעות מתומחרות שטרם חויבו בתיק הזה.",
  MATTER_NOT_FOUND: "התיק לא נמצא.",
  FORBIDDEN: "רק בעלים או עורך דין יכולים להפיק דרישת תשלום.",
  ALREADY_PAID: "דרישה ששולמה לא ניתנת לביטול.",
  INVOICE_NOT_FOUND: "הדרישה לא נמצאה.",
};

function explain(error: { message: string }): string {
  const named = Object.keys(ASSEMBLY_TROUBLE).find((k) => error.message.includes(k));
  return named ? ASSEMBLY_TROUBLE[named] : describeDbError(error as Error);
}

export async function createInvoiceFromUnbilled(
  matterId: string,
  vatRate: number,
): Promise<string> {
  const { data, error } = await supabase.rpc("create_invoice_from_unbilled", {
    p_matter_id: matterId,
    p_vat_rate: vatRate,
  });
  if (error) throw new Error(explain(error));
  return data as string;
}

export async function cancelInvoice(id: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_invoice", { p_invoice_id: id });
  if (error) throw new Error(explain(error));
}

/**
 * Marking a demand sent or paid. The dates the constraints require are set
 * here rather than left to the caller, so no screen can save a half state.
 */
export async function markInvoice(id: string, status: "issued" | "paid"): Promise<void> {
  const now = new Date().toISOString();
  const patch =
    status === "issued"
      ? { status, issued_at: now, updated_at: now }
      : { status, paid_at: now, updated_at: now };
  const { error } = await supabase.from("invoices").update(patch).eq("id", id);
  if (error) throw new Error(explain(error));
}

/** Where the real tax invoice ended up, once someone issued it in Morning. */
export async function linkExternalInvoice(
  id: string,
  provider: string,
  externalId: string,
  url: string,
): Promise<void> {
  const { error } = await supabase
    .from("invoices")
    .update({
      external_provider: provider.trim() || null,
      external_invoice_id: externalId.trim() || null,
      external_url: url.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(explain(error));
}
