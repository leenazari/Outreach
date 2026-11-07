import { Suspense } from "react";
import { connection } from "next/server";
import { Finder } from "@/components/finder";

function FinderFallback() {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-10 sm:px-6">
      <div className="h-40 animate-pulse rounded-2xl border border-border bg-card" />
      <div className="h-64 animate-pulse rounded-2xl border border-border bg-card" />
    </div>
  );
}

async function FinderWithToken() {
  await connection();
  const tokenConfigured = Boolean(process.env.APIFY_TOKEN?.trim());
  return <Finder tokenConfigured={tokenConfigured} />;
}

export default function Home() {
  return (
    <Suspense fallback={<FinderFallback />}>
      <FinderWithToken />
    </Suspense>
  );
}
