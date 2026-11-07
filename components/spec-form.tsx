"use client";

import { VoiceSpec } from "@/components/voice-spec";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { SearchRequest } from "@/lib/types";

type SpecFormProps = {
  value: SearchRequest;
  loading: boolean;
  onChange: (value: SearchRequest) => void;
  onSubmit: () => void;
};

function FieldHint({ children }: { children: string }) {
  return <p className="text-sm leading-5 text-muted-foreground">{children}</p>;
}

export function SpecForm({ value, loading, onChange, onSubmit }: SpecFormProps) {
  function update<K extends keyof SearchRequest>(key: K, next: SearchRequest[K]) {
    onChange({ ...value, [key]: next });
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
      <VoiceSpec
        disabled={loading}
        onUseText={(text) => update("specText", text)}
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
          onChange={(event) => update("specText", event.target.value)}
        />
        <FieldHint>
          The server reads this into a title, location, pay band, and requirements. UK as a place name is a poor
          LinkedIn filter. Prefer United Kingdom or a city.
        </FieldHint>
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
          id="includeIndeed"
          checked={value.includeIndeed}
          onCheckedChange={(checked) => update("includeIndeed", checked)}
        />
        <div className="grid gap-1">
          <Label htmlFor="includeIndeed">Include Indeed</Label>
          <p className="text-sm leading-5 text-muted-foreground">
            On by default. Indeed is capped at three resumes and is the expensive part of a search, because of the
            resume fee and the US residential proxy.
          </p>
        </div>
      </div>

      <p className="text-sm leading-5 text-muted-foreground">
        A live search calls Apify. The charge is shown with the results and on the spend log.
      </p>

      <Button type="submit" disabled={loading}>
        {loading ? "Searching public sources…" : "Rank public profiles"}
      </Button>
    </form>
  );
}
