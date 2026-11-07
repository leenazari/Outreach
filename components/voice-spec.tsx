"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { applySpeechEvent, emptyTranscript, transcriptPreview, type TranscriptState } from "@/lib/speech-control";

type SpeechAlternative = { transcript: string };
type SpeechResult = { isFinal: boolean; 0: SpeechAlternative };
type SpeechResultEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };

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

function restartsEachUtterance(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
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
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const transcriptRef = useRef<TranscriptState>(emptyTranscript());
  const recordingRef = useRef(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      recordingRef.current = false;
      recognitionRef.current?.abort();
    };
  }, []);

  function publish(state: TranscriptState) {
    transcriptRef.current = state;
    setPreview(transcriptPreview(state));
  }

  function commitTranscript() {
    const spoken = transcriptPreview(transcriptRef.current);
    transcriptRef.current = emptyTranscript();
    setPreview("");
    if (spoken) {
      onUseText(spoken);
      setMessage("Added to the job spec. You can edit it before searching.");
    }
  }

  function attach(recognition: BrowserSpeechRecognition) {
    const restarting = restartsEachUtterance();
    recognition.lang = "en-GB";
    recognition.continuous = !restarting;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const results = [];
      for (let index = 0; index < event.results.length; index += 1) {
        results.push({
          transcript: event.results[index]?.[0]?.transcript ?? "",
          isFinal: Boolean(event.results[index]?.isFinal),
        });
      }
      publish(applySpeechEvent(transcriptRef.current, { resultIndex: event.resultIndex ?? 0, results }));
    };
    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      if (event.error === "not-allowed") {
        recordingRef.current = false;
        setListening(false);
        setMessage("Microphone permission was blocked. You can still type the spec.");
      }
    };
    recognition.onend = () => {
      if (unmountedRef.current) return;
      if (recordingRef.current && restarting) {
        try {
          recognition.start();
          return;
        } catch {
          recordingRef.current = false;
        }
      }
      setListening(false);
      if (!recordingRef.current) commitTranscript();
    };
  }

  function stopListening() {
    recordingRef.current = false;
    const recognition = recognitionRef.current;
    if (!recognition) {
      commitTranscript();
      setListening(false);
      return;
    }
    recognition.stop();
  }

  function startListening() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    attach(recognition);
    recognitionRef.current = recognition;
    transcriptRef.current = emptyTranscript();
    setPreview("");
    setMessage(null);
    recordingRef.current = true;
    try {
      recognition.start();
      setListening(true);
    } catch {
      recordingRef.current = false;
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
          {listening ? "Stop recording" : "Start recording"}
        </Button>
        {supported === "unknown" ? (
          <span className="text-sm text-muted-foreground">Checking the microphone…</span>
        ) : null}
      </div>
      {listening ? (
        <p
          className="flex items-start gap-2 rounded-xl border border-[#efc7c7] bg-[#fdf2f2] px-3 py-2 text-sm leading-6 text-[#8c3030]"
          role="status"
        >
          <span className="mt-1.5 inline-block size-2 shrink-0 rounded-full bg-[#c24141]" aria-hidden />
          <span>
            <span className="font-medium">Recording.</span>{" "}
            {preview || "Listening in English (UK). The words go into the job spec when you stop."}
          </span>
        </p>
      ) : null}
      {message ? <p className="text-sm leading-5 text-muted-foreground">{message}</p> : null}
    </div>
  );
}
