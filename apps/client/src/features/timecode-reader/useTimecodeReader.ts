import { useEffect, useRef, useState } from 'react';
import type { TimecodeFrame, TimecodeReaderStatus } from 'ontime-types';

import { socketSendJson } from '../../common/utils/socket';

import workletUrl from './ltc/ltc.worklet.ts?worker&url';

export type ReaderSetup = {
  enabled: boolean;
  deviceLabel: string;
  channel: number; // 1-based
  /** play generated timecode into the reader instead of recording, starting here */
  testSignal: TimecodeFrame | null;
};

export type ReaderView = {
  status: TimecodeReaderStatus;
  lastFrame: TimecodeFrame | null;
  /** the browser would not start audio without a click */
  needsGesture: boolean;
  start: () => void;
};

const statusInterval = 1000;

const emptyStatus = (channel: number): TimecodeReaderStatus => ({
  devices: [],
  deviceLabel: '',
  channel,
  level: 0,
  error: '',
});

/** the inputs the browser can see, by name. Names only appear once recording has been allowed */
async function listInputs(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((device) => device.kind === 'audioinput' && device.deviceId !== 'default');
}

/**
 * Records the timecode channel, decodes it on the audio thread and sends each frame to the server.
 * Rebuilds itself whenever the input, channel or on/off setting changes.
 */
export function useTimecodeReader(setup: ReaderSetup): ReaderView {
  const [status, setStatus] = useState<TimecodeReaderStatus>(() => emptyStatus(setup.channel));
  const [lastFrame, setLastFrame] = useState<TimecodeFrame | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const contextRef = useRef<AudioContext | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const testKey = setup.testSignal ? JSON.stringify(setup.testSignal) : '';

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let peak = 0;

    const report = (patch: Partial<TimecodeReaderStatus>) => {
      if (cancelled) return;
      setStatus((previous) => ({ ...previous, ...patch, channel: setup.channel }));
    };

    async function run() {
      setStatus(emptyStatus(setup.channel));
      setLastFrame(null);

      if (!setup.enabled && !setup.testSignal) {
        report({ error: 'Timecode is turned off in settings' });
        return;
      }

      try {
        context = new AudioContext({ latencyHint: 'interactive' });
        contextRef.current = context;
        await context.audioWorklet.addModule(workletUrl);
        if (cancelled) return;

        let source: AudioNode;
        let deviceLabel = '';

        if (setup.testSignal) {
          source = new AudioWorkletNode(context, 'ltc-generator', {
            numberOfInputs: 0,
            outputChannelCount: [Math.max(2, setup.channel)],
            processorOptions: { start: setup.testSignal },
          });
          deviceLabel = 'Test signal';
        } else {
          if (!navigator.mediaDevices?.getUserMedia) {
            report({ error: 'This browser cannot record audio here. Open the reader on localhost or over https' });
            return;
          }

          // names are hidden until recording is allowed, so ask once with the default input first
          let inputs = await listInputs();
          if (inputs.every((input) => input.label === '')) {
            const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
            probe.getTracks().forEach((track) => track.stop());
            inputs = await listInputs();
          }
          if (cancelled) return;

          const wanted = setup.deviceLabel ? inputs.find((input) => input.label === setup.deviceLabel) : undefined;
          report({ devices: inputs.map((input) => input.label).filter(Boolean) });
          if (setup.deviceLabel && !wanted) {
            report({ error: `Input "${setup.deviceLabel}" was not found on this machine` });
            return;
          }

          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              ...(wanted ? { deviceId: { exact: wanted.deviceId } } : {}),
              channelCount: { ideal: Math.max(2, setup.channel) },
              // timecode is data, not voice: any processing would garble it
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });
          if (cancelled) return;
          deviceLabel = stream.getAudioTracks()[0]?.label ?? wanted?.label ?? '';
          source = context.createMediaStreamSource(stream);
        }

        const reader = new AudioWorkletNode(context, 'ltc-reader', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: Math.max(2, setup.channel),
          channelCountMode: 'explicit',
          channelInterpretation: 'discrete',
          processorOptions: { channel: setup.channel - 1 },
        });
        reader.port.onmessage = (event: MessageEvent) => {
          const message = event.data;
          if (message?.type === 'frame') {
            socketSendJson('timecode-frame', message.frame);
            setLastFrame(message.frame);
          } else if (message?.type === 'level') {
            peak = Math.max(peak, message.level);
            if (typeof message.channels === 'number' && message.channels > 0 && message.channels < setup.channel) {
              report({
                error: `This input gives Ontime ${message.channels} channels. Route the timecode to channel 1 or 2`,
              });
            }
          }
        };

        // a node only runs while something downstream pulls on it: a silent gain keeps it going
        const mute = context.createGain();
        mute.gain.value = 0;
        source.connect(reader);
        reader.connect(mute);
        mute.connect(context.destination);

        report({ deviceLabel, error: '' });

        if (context.state === 'suspended') {
          await context.resume().catch(() => undefined);
        }
        setNeedsGesture(context.state === 'suspended');
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'Ontime is not allowed to record audio. Allow it in System Settings → Privacy & Security → Microphone'
            : `Could not start reading timecode: ${error instanceof Error ? error.message : String(error)}`;
        report({ error: message });
      }
    }

    run();

    const timer = setInterval(() => {
      const next = { ...statusRef.current, level: peak };
      peak = 0;
      setStatus(next);
      socketSendJson('timecode-reader', next);
    }, statusInterval);

    return () => {
      cancelled = true;
      clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      context?.close().catch(() => undefined);
      contextRef.current = null;
    };
    // the test signal is compared by value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.enabled, setup.deviceLabel, setup.channel, testKey]);

  const start = () => {
    contextRef.current
      ?.resume()
      .then(() => setNeedsGesture(contextRef.current?.state === 'suspended'))
      .catch(() => undefined);
  };

  return { status, lastFrame, needsGesture, start };
}
