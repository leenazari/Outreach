"use client";

import { useState } from "react";
import { EMPTY_REQUEST } from "@/components/demo-spec";
import { ResultList } from "@/components/result-list";
import { SpecForm } from "@/components/spec-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SearchRequest, SearchResponse } from "@/lib/types";

function isSearchResponse(value: unknown): value is SearchResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (record.mode === "sample" || record.mode === "live") && Array.isArray(record.candidates);
}

export function Finder({ tokenConfigured }: { tokenConfigured: boolean }) {
  const [form, setForm] = useState<SearchRequest>(EMPTY_REQUEST);
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);

  async function onSubmit() {
    setStatus("loading");
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "The search could not be completed.";
        setStatus("error");
        setError(message);
        return;
      }
      if (!isSearchResponse(payload)) {
        setStatus("error");
        setError("The server returned an unexpected payload.");
        return;
      }
      setResult(payload);
      setStatus("ready");
    } catch {
      setStatus("error");
      setError("The browser could not reach the search route.");
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start lg:py-10">
      <Card className="lg:sticky lg:top-6">
        <CardHeader>
          <CardTitle>Job spec</CardTitle>
          <CardDescription>
            Paste a job spec. It is read into a title, place, pay band, and requirements.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SpecForm value={form} loading={status === "loading"} onChange={setForm} onSubmit={onSubmit} />
        </CardContent>
      </Card>
      <ResultList status={status} error={error} result={result} tokenConfigured={tokenConfigured} />
    </div>
  );
}
