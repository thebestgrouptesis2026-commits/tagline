"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUserId } from "@/lib/auth";
import { recategorize } from "@/repositories/movements.repo";

const input = z.object({ transactionId: z.uuid(), categoryId: z.uuid().nullable() });

export async function setCategory(transactionId: string, categoryId: string | null): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const parsed = input.safeParse({ transactionId, categoryId });
  if (!parsed.success) return { ok: false };
  const ok = await recategorize(getDb(), userId, parsed.data.transactionId, parsed.data.categoryId);
  if (ok) refresh();
  return { ok };
}
