"use client";

import { VoiceSpec } from "@/components/voice-spec";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { CURRENCIES } from "@/components/demo-spec";
import { salaryLabel } from "@/lib/parse";
import type { SpokenSpec } from "@/lib/parse-speech";
import type { SearchRequest } from "@/lib/types";

type SpecFormProps = {
  value: SearchRequest;
  loading: boolean;
  tokenConfigured: boolean;
  onChange: (value: SearchRequest) => void;
  onSubmit: () => void;
};

function FieldHint({ children }: { children: string }) {
  return <p className="text-sm leading-5 text-muted-foreground">{children}</p>;
}

export function SpecForm({ value, loading, tokenConfigured, onChange, onSubmit }: SpecFormProps) {
  function update<K extends keyof SearchRequest>(key: K, next: SearchRequest[K]) {
    onChange({ ...value, [key]: next });
  }

  function applySpoken(spec: SpokenSpec) {
    onChange({
      ...value,
      jobTitle: spec.jobTitle || value.jobTitle,
      location: spec.location || value.location,
      salaryMin: spec.salaryMin,
      salaryMax: spec.salaryMax,
      salaryCurrency: spec.salaryCurrency || value.salaryCurrency,
      mustHave: spec.mustHave,
      niceToHave: spec.niceToHave,
    });
  }

  return (
    <form
      className="grid gap-5"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <VoiceSpec disabled={loading} onApply={applySpoken} />
      <div className="grid gap-2">
        <Label htmlFor="jobTitle">Job title</Label>
        <Input
          id="jobTitle"
          name="jobTitle"
          required
          value={value.jobTitle}
          onChange={(event) => update("jobTitle", event.target.value)}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          name="location"
          required
          placeholder="London"
          value={value.location}
          onChange={(event) => update("location", event.target.value)}
        />
        <FieldHint>
          Use a city, or United Kingdom. The shorthand UK is a poor LinkedIn filter and can resolve to Ukraine.
        </FieldHint>
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Salary range</legend>
        <div className="grid grid-cols-[5.5rem_1fr_1fr] gap-2">
          <label className="sr-only" htmlFor="salaryCurrency">
            Currency
          </label>
          <select
            id="salaryCurrency"
            className="h-11 rounded-xl border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            value={value.salaryCurrency}
            onChange={(event) => update("salaryCurrency", event.target.value)}
          >
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
          <Input
            id="salaryMin"
            inputMode="numeric"
            aria-label="Salary minimum"
            placeholder="40000"
            value={value.salaryMin}
            onChange={(event) => update("salaryMin", event.target.value)}
          />
          <Input
            id="salaryMax"
            inputMode="numeric"
            aria-label="Salary maximum"
            placeholder="50000"
            value={value.salaryMax}
            onChange={(event) => update("salaryMax", event.target.value)}
          />
        </div>
        <FieldHint>{`Salary range: ${salaryLabel(value)}. Display only. It is not sent to Apify and it is not scored.`}</FieldHint>
      </fieldset>

      <div className="grid gap-2">
        <Label htmlFor="mustHave">Must-have requirements</Label>
        <Textarea
          id="mustHave"
          value={value.mustHave}
          onChange={(event) => update("mustHave", event.target.value)}
          placeholder={"Figma\nuser research"}
        />
        <FieldHint>
          One per line, or commas. Anyone missing a phrase is dropped. Matching is a case-insensitive substring
          across title, headline, skills, summary, and snippet.
        </FieldHint>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="niceToHave">Nice-to-have requirements</Label>
        <Textarea
          id="niceToHave"
          value={value.niceToHave}
          onChange={(event) => update("niceToHave", event.target.value)}
          placeholder={"B2B SaaS\naccessibility"}
        />
        <FieldHint>Each match adds 15 points, up to 60.</FieldHint>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="watchPhrases">Competitor tools or complaint phrases</Label>
        <Textarea
          id="watchPhrases"
          value={value.watchPhrases}
          onChange={(event) => update("watchPhrases", event.target.value)}
          placeholder={"Greenhouse\nATS is painful"}
        />
        <FieldHint>
          Optional. Posts are searched only when this is filled in. Five phrases are sent at most. A match adds 15
          points.
        </FieldHint>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-border bg-[#f8f3ea] px-3 py-3">
        <Switch
          id="useSampleData"
          checked={value.useSampleData}
          onCheckedChange={(checked) => update("useSampleData", checked)}
        />
        <div className="grid gap-1">
          <Label htmlFor="useSampleData">Use sample data</Label>
          <p className="text-sm leading-5 text-muted-foreground">
            {tokenConfigured
              ? "A token is configured on the server. Leave this on to demo for free. Turn it off and a live search spends Apify credits."
              : "No APIFY_TOKEN is set on the server. Turning this off still returns sample data, with a notice."}
          </p>
        </div>
      </div>

      <Button type="submit" disabled={loading}>
        {loading ? "Searching public sources…" : "Rank public profiles"}
      </Button>
    </form>
  );
}
