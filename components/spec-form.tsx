"use client";

import { useEffect, useRef, useState } from "react";
import { VoiceSpec } from "@/components/voice-spec";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CURRENCIES } from "@/components/demo-spec";
import { estimateSearchCost, formatEstimate } from "@/lib/estimate";
import { applyParsedSpec, type ParsedSpecFields } from "@/lib/form-fill";
import type { SearchRequest } from "@/lib/types";

type SpecFormProps = {
  value: SearchRequest;
  loading: boolean;
  revision: number;
  onChange: (value: SearchRequest) => void;
  onSubmit: () => void;
  onRerun: () => void;
};

function SearchEstimate({ value }: { value: SearchRequest }) {
  const estimate = estimateSearchCost({
    openToWork: value.openToWork,
    includeIndeed: value.includeIndeed,
    includeEmail: value.includeEmail,
    watchPhrases: value.watchPhrases.trim().length > 0,
  });
  const breakdown = estimate.lines.map((line) => `${line.label} ${formatEstimate(line.usd)}`).join(", ");
  return (
    <p className="text-sm leading-5 text-muted-foreground">
      Estimated cost <span className="font-medium text-foreground">{formatEstimate(estimate.totalUsd)}</span>
      <span className="mt-1 block">{breakdown}. The spend log records what Apify actually charges.</span>
    </p>
  );
}

function FieldHint({ children }: { children: string }) {
  return <p className="text-sm leading-5 text-muted-foreground">{children}</p>;
}

export function SpecForm({ value, loading, revision, onChange, onSubmit, onRerun }: SpecFormProps) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const touched = useRef(new Set<string>());
  const immediate = useRef(false);
  const [reading, setReading] = useState(false);

  function update<K extends keyof SearchRequest>(key: K, next: SearchRequest[K]) {
    onChange({ ...valueRef.current, [key]: next });
  }

  function edit<K extends keyof SearchRequest>(key: K, next: SearchRequest[K]) {
    touched.current.add(String(key));
    onChange({ ...valueRef.current, [key]: next, lockedFields: [...touched.current] });
  }

  useEffect(() => {
    touched.current = new Set(value.lockedFields ?? []);
  }, [revision]);

  useEffect(() => {
    const text = value.specText.trim();
    if (text.length < 12) {
      setReading(false);
      return;
    }
    const delay = immediate.current ? 0 : 800;
    immediate.current = false;
    const handle = window.setTimeout(() => {
      setReading(true);
      void fetch("/api/parse-spec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      })
        .then(async (response) => {
          if (!response.ok) return null;
          return (await response.json()) as Partial<ParsedSpecFields>;
        })
        .then((parsed) => {
          if (!parsed || valueRef.current.specText.trim() !== text) return;
          onChange(applyParsedSpec(valueRef.current, parsed, touched.current));
        })
        .catch(() => undefined)
        .finally(() => {
          if (valueRef.current.specText.trim() === text) setReading(false);
        });
    }, delay);
    return () => window.clearTimeout(handle);
  }, [onChange, value.specText]);

  return (
    <form
      className="grid gap-5"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <VoiceSpec
        disabled={loading}
        onUseText={(text) => {
          immediate.current = true;
          update("specText", text);
        }}
      />
      <div className="grid gap-2">
        <Label htmlFor="specText">Job spec</Label>
        <Textarea
          id="specText"
          name="specText"
          required
          rows={8}
          value={value.specText}
          placeholder="Paste or type a job spec. For example: Sales Executive in London, £40,000 to £50,000, must have 2 years of B2B sales and a full UK driving licence."
          onPaste={() => {
            immediate.current = true;
          }}
          onChange={(event) => update("specText", event.target.value)}
        />
        {reading ? <p className="text-sm text-muted-foreground">Reading your spec...</p> : null}
        <FieldHint>
          The full text is kept for scoring. LinkedIn is searched with a short title and the location field. Fields
          below fill in from this text and stay editable.
        </FieldHint>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="jobTitle">Job title</Label>
          <Input id="jobTitle" value={value.jobTitle} onChange={(event) => edit("jobTitle", event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="location">Location</Label>
          <Input id="location" value={value.location} onChange={(event) => edit("location", event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seniority">Seniority</Label>
          <Input id="seniority" value={value.seniority} onChange={(event) => edit("seniority", event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="yearsExperience">Years of experience</Label>
          <Input id="yearsExperience" value={value.yearsExperience} onChange={(event) => edit("yearsExperience", event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="salaryMin">Pay from</Label>
          <Input id="salaryMin" value={value.salaryMin} onChange={(event) => edit("salaryMin", event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="salaryMax">Pay to</Label>
          <Input id="salaryMax" value={value.salaryMax} onChange={(event) => edit("salaryMax", event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="salaryCurrency">Currency</Label>
          <select
            id="salaryCurrency"
            value={value.salaryCurrency}
            onChange={(event) => edit("salaryCurrency", event.target.value)}
            className="h-11 rounded-xl border border-input bg-card px-3 text-sm"
          >
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="searchTitle">LinkedIn search</Label>
          <Input id="searchTitle" value={value.searchTitle} onChange={(event) => edit("searchTitle", event.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="workplace">Remote / hybrid</Label>
          <Input id="workplace" value={value.workplace} onChange={(event) => edit("workplace", event.target.value)} placeholder="Remote, hybrid, or office" />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="industry">Industry</Label>
          <Input id="industry" value={value.industry} onChange={(event) => edit("industry", event.target.value)} />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="mustHave">Must-haves</Label>
          <Textarea id="mustHave" rows={3} value={value.mustHave} onChange={(event) => edit("mustHave", event.target.value)} />
        </div>
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="niceToHave">Nice-to-haves</Label>
          <Textarea id="niceToHave" rows={2} value={value.niceToHave} onChange={(event) => edit("niceToHave", event.target.value)} />
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="watchPhrases">Competitor tools or complaint phrases</Label>
        <Textarea
          id="watchPhrases"
          value={value.watchPhrases}
          onChange={(event) => update("watchPhrases", event.target.value)}
          placeholder="Greenhouse, ATS is painful"
        />
        <FieldHint>
          Optional. Posts are searched only when this is filled in. Three phrases are sent at most, and at most five
          posts.
        </FieldHint>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-border bg-[#f8f3ea] px-3 py-3">
        <Switch
          id="openToWork"
          checked={value.openToWork}
          onCheckedChange={(checked) => update("openToWork", checked)}
        />
        <div className="grid gap-1">
          <Label htmlFor="openToWork">Open to Work</Label>
          <p className="text-sm leading-5 text-muted-foreground">
            On by default. LinkedIn does not offer this filter outside Recruiter, so the search reads one full page of
            25 short profiles, then a full profile for each person still in range, and also searches recent posts from
            people who say they are looking.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-border bg-[#f8f3ea] px-3 py-3">
        <Switch
          id="includeEmail"
          checked={value.includeEmail}
          onCheckedChange={(checked) => update("includeEmail", checked)}
        />
        <div className="grid gap-1">
          <Label htmlFor="includeEmail">Email search on the enriched LinkedIn profiles</Label>
          <p className="text-sm leading-5 text-muted-foreground">
            Off by default. Each returned LinkedIn profile is enriched at $0.004 with no email. This switch adds a
            $0.01 email lookup on those same profiles.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-border bg-[#f8f3ea] px-3 py-3">
        <Switch
          id="recentlyChangedJobs"
          checked={value.recentlyChangedJobs}
          onCheckedChange={(checked) => update("recentlyChangedJobs", checked)}
        />
        <div className="grid gap-1">
          <Label htmlFor="recentlyChangedJobs">Recently changed jobs</Label>
          <p className="text-sm leading-5 text-muted-foreground">
            Off by default, so the LinkedIn search is not limited to people who changed jobs in the last 90 days.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-border bg-[#f8f3ea] px-3 py-3">
        <Switch
          id="includeIndeed"
          checked={value.includeIndeed}
          onCheckedChange={(checked) => update("includeIndeed", checked)}
        />
        <div className="grid gap-1">
          <Label htmlFor="includeIndeed">Include Indeed</Label>
          <p className="text-sm leading-5 text-muted-foreground">
            Off by default, and experimental. Indeed often fails while the session is starting and still bills the
            actor-start fee. When it works, it is capped at three resumes and needs a US residential proxy.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchEstimate value={value} />
        <div className="flex flex-col gap-2">
          <Button type="submit" disabled={loading}>
            {loading ? "Searching public sources…" : "Rank public profiles"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading || (!value.specText.trim() && !value.jobTitle.trim())}
            onClick={onRerun}
          >
            Rerun last search
          </Button>
        </div>
      </div>
    </form>
  );
}
