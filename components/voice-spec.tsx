"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { SpokenSpec } from "@/lib/parse-speech";

type SpeechAlternative = { transcript: string };
type SpeechResult = { isFinal: boolean; 0: SpeechAlternative };
type SpeechResultEvent = { results: ArrayLike<SpeechResult> };

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechWindow = Window & {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
};

function recognitionCtor(): (new () => BrowserSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function subscribeToSpeechSupport() {
  return () => {};
}

function speechSupportSnapshot(): "yes" | "no" {
  return recognitionCtor() ? "yes" : "no";
}

export function VoiceSpec({
  disabled,
  onApply,
}: {
  disabled: boolean;
  onApply: (spec: SpokenSpec) => void;
}) {
  const supported = useSyncExternalStore(subscribeToSpeechSupport, speechSupportSnapshot, () => "unknown");
  const [listening, setListening] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const transcriptRef = useRef("");
  const shouldParseRef = useRef(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      shouldParseRef.current = false;
      recognitionRef.current?.abort();
    };
  }, []);

  async function fillFromTranscript(spoken: string) {
    const text = spoken.trim();
    if (!text || unmountedRef.current) return;
    setParsing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/parse-spec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const error =
          payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
            ? payload.error
            : "The recording could not be read into the form.";
        setMessage(error);
        return;
      }
      if (!payload || typeof payload !== "object" || !("parser" in payload)) {
        setMessage("The recording could not be read into the form.");
        return;
      }
      onApply(payload as SpokenSpec);
      setMessage("Filled from what you said. Review the fields, then search when they look right.");
    } catch {
      setMessage("The browser could not reach the parser.");
    } finally {
      if (!unmountedRef.current) setParsing(false);
    }
  }

  function stopListening() {
    shouldParseRef.current = true;
    recognitionRef.current?.stop();
  }

  function startListening() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = "en-GB";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let spoken = "";
      for (let index = 0; index < event.results.length; index += 1) {
        spoken += event.results[index]?.[0]?.transcript ?? "";
      }
      const next = spoken.replace(/\s+/g, " ").trim();
      transcriptRef.current = next;
      setTranscript(next);
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted") return;
      shouldParseRef.current = false;
      if (event.error === "not-allowed") {
        setMessage("Microphone permission was blocked. You can still type the spec.");
      } else if (event.error === "no-speech") {
        setMessage("No speech was heard. Try again, or type the spec.");
      } else {
        setMessage("Speech recognition stopped. You can type the spec instead.");
      }
    };
    recognition.onend = () => {
      setListening(false);
      const spoken = transcriptRef.current;
      const shouldParse = shouldParseRef.current;
      shouldParseRef.current = false;
      if (shouldParse) void fillFromTranscript(spoken);
    };
    recognitionRef.current = recognition;
    transcriptRef.current = "";
    setTranscript("");
    setMessage(null);
    shouldParseRef.current = false;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setMessage("The microphone could not start. Type the spec instead.");
    }
  }

  if (supported === "no") {
    return (
      <p className="text-sm leading-5 text-muted-foreground">
        This browser cannot transcribe speech. Type the spec instead.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || parsing || supported !== "yes"}
          onClick={listening ? stopListening : startListening}
          aria-pressed={listening}
        >
          {listening ? "Stop and fill the form" : parsing ? "Reading the recording…" : "Speak the spec"}
        </Button>
        {supported === "unknown" ? (
          <span className="text-sm text-muted-foreground">Checking the microphone…</span>
        ) : null}
      </div>
      {transcript ? (
        <p className="text-sm leading-6" aria-live="polite">
          <span className="font-medium">Heard: </span>
          {transcript}
        </p>
      ) : null}
      {listening ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Listening in English (UK). Speak the role, place, pay, and what is essential.
        </p>
      ) : null}
      {message ? <p className="text-sm leading-5 text-muted-foreground">{message}</p> : null}
    </div>
  );
}
