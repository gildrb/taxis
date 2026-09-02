import { useCallback, useEffect, useRef, useState } from "react";

export function useAudioMeter() {
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string>();
  const level = useRef(0);
  const cleanup = useRef<() => void>(() => undefined);

  useEffect(() => () => cleanup.current(), []);

  const toggle = useCallback(async () => {
    if (enabled) {
      cleanup.current();
      setEnabled(false);
      level.current = 0;
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(stream).connect(analyser);
      const frequencies = new Uint8Array(analyser.frequencyBinCount);
      let frame = 0;
      const measure = () => {
        analyser.getByteFrequencyData(frequencies);
        const average = frequencies.reduce((sum, value) => sum + value, 0) / frequencies.length / 255;
        level.current += (average - level.current) * 0.22;
        frame = requestAnimationFrame(measure);
      };
      measure();
      cleanup.current = () => {
        cancelAnimationFrame(frame);
        for (const track of stream.getTracks()) track.stop();
        void context.close();
      };
      setError(undefined);
      setEnabled(true);
    } catch {
      setError("Microphone access was not granted.");
    }
  }, [enabled]);

  return { enabled, error, level, toggle };
}
