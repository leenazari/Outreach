import { Suspense } from "react";
import { connection } from "next/server";
import { SpendView } from "@/components/spend-view";
import { loadSpendLog } from "@/lib/spend-log";

export const maxDuration = 60;

function SpendFallback() {
  return <p className="mx-auto max-w-6xl px-4 py-10 text-sm text-muted-foreground">Reading Apify run charges…</p>;
}

async function SpendLoaded() {
  await connection();
  const log = await loadSpendLog(process.env.APIFY_TOKEN);
  return <SpendView log={log} />;
}

export default function SpendPage() {
  return (
    <Suspense fallback={<SpendFallback />}>
      <SpendLoaded />
    </Suspense>
  );
}
