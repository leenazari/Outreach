"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { foldSpeech, type SpeechChunk } from "@/lib/speech-control";

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
  onUseText,
}: {
  disabled: boolean;
  onUseText: (text: string) => void;
}) {
  const supported = useSyncExternalStore(subscribeToSpeechSupport, speechSupportSnapshot, () => "unknown");
  const [listening, setListening] = useState(false);
  const [paused, setPaused] = useState(false);
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
      const chunks: SpeechChunk[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        chunks.push({
          text: event.results[index]?.[0]?.transcript ?? "",
          isFinal: Boolean(event.results[index]?.isFinal),
        });
      }
      const folded = foldSpeech(chunks);
      transcriptRef.current = folded.text;
      setTranscript(folded.text);
      setPaused(folded.paused);
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
      const shouldUse = shouldParseRef.current;
      shouldParseRef.current = false;
      if (shouldUse && spoken.trim()) {
        onUseText(spoken.trim());
        setMessage("Added to the spec. Review it, then search when it looks right.");
      }
    };
    recognitionRef.current = recognition;
    transcriptRef.current = "";
    setTranscript("");
    setPaused(false);
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
          disabled={disabled || supported !== "yes"}
          onClick={listening ? stopListening : startListening}
          aria-pressed={listening}
        >
          {listening ? "Stop and use this text" : "Speak the spec"}
        </Button>
        {supported === "unknown" ? (
          <span className="text-sm text-muted-foreground">Checking the microphone…</span>
        ) : null}
      </div>
      <p className="text-sm leading-5 text-muted-foreground">
        Say “pause” or “pause bot” to stop adding words. Say “continue”, “unpause”, or “unpause bot” to resume. Those
        words are left out of the spec.
      </p>
      {paused && listening ? (
        <p className="rounded-xl border border-[#efd3ae] bg-[#fbf3e6] px-3 py-2 text-sm font-medium text-[#7a4510]" role="status">
          Paused. Nothing you say is added until you say continue, unpause, or unpause bot.
        </p>
      ) : null}
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
