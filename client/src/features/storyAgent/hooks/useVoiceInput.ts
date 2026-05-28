import { useCallback, useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';

type VoiceInputStatus = 'idle' | 'recording' | 'transcribing';

type UseVoiceInputOptions = {
  language?: string;
  onTranscribed: (text: string) => void;
  onError?: (message: string) => void;
};

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getRecorderMimeType(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
      return '麦克风权限被拒绝了，可以在浏览器地址栏左侧重新打开权限。';
    }
    if (error.name === 'NotFoundError') {
      return '没有找到可用的麦克风。';
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return '语音转写失败，请再试一次。';
}

export function useVoiceInput({
  language = 'zh',
  onTranscribed,
  onError = (message) => alert(message),
}: UseVoiceInputOptions) {
  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const chunksRef = useRef<BlobPart[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);
  const transcribeMutation = trpc.voice.transcribe.useMutation();

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const resetRecorder = useCallback(() => {
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    releaseStream();
  }, [releaseStream]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      resetRecorder();
      setStatus('idle');
      return;
    }
    recorder.stop();
  }, [resetRecorder]);

  const startRecording = useCallback(async () => {
    if (status !== 'idle') return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError('当前浏览器不支持录音，请换 Chrome 或 Safari 新版本再试。');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getRecorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      streamRef.current = stream;
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        onError('录音失败，请检查麦克风后再试。');
        resetRecorder();
        if (mountedRef.current) setStatus('idle');
      };

      recorder.onstop = async () => {
        const chunks = chunksRef.current;
        const outputMimeType = recorder.mimeType || mimeType || 'audio/webm';

        releaseStream();
        if (!mountedRef.current) {
          resetRecorder();
          return;
        }

        setStatus('transcribing');

        try {
          const audioBlob = new Blob(chunks, { type: outputMimeType });
          if (audioBlob.size === 0) {
            onError('没有录到声音，可以再试一次。');
            return;
          }

          const audioBase64 = await blobToBase64(audioBlob);
          const result = await transcribeMutation.mutateAsync({
            audioBase64,
            mimeType: outputMimeType,
            language,
          });
          const text = result.text.trim();

          if (!text) {
            onError('这段语音没有识别出文字，可以再说一遍。');
            return;
          }

          onTranscribed(text);
        } catch (error) {
          onError(getErrorMessage(error));
        } finally {
          resetRecorder();
          if (mountedRef.current) setStatus('idle');
        }
      };

      recorder.start();
      setStatus('recording');
    } catch (error) {
      resetRecorder();
      setStatus('idle');
      onError(getErrorMessage(error));
    }
  }, [language, onError, onTranscribed, resetRecorder, releaseStream, status, transcribeMutation]);

  const toggleRecording = useCallback(() => {
    if (status === 'recording') {
      stopRecording();
      return;
    }
    if (status === 'idle') {
      void startRecording();
    }
  }, [startRecording, status, stopRecording]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      releaseStream();
    };
  }, [releaseStream]);

  return {
    status,
    isRecording: status === 'recording',
    isTranscribing: status === 'transcribing',
    isBusy: status === 'recording' || status === 'transcribing',
    toggleRecording,
    stopRecording,
  };
}
