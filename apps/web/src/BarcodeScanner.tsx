import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Chamado a cada leitura (o mesmo código só dispara de novo após ~1,5 s). Pode devolver uma mensagem para mostrar na tela. */
  onCode: (code: string) => Promise<string | void> | string | void;
  onClose: () => void;
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

/**
 * Leitor de código de barras pela câmera. Usa o BarcodeDetector nativo (Chrome/Android) e, quando
 * não existe (iPhone/Safari, Firefox), carrega a biblioteca ZXing sob demanda. Exige HTTPS (ou localhost).
 * Modo contínuo: a câmera continua aberta para bipar vários produtos em sequência.
 */
export function BarcodeScanner({ onCode, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Iniciando câmera…');
  const [err, setErr] = useState('');
  const last = useRef({ code: '', at: 0 });
  const handler = useRef(onCode);
  handler.current = onCode;

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let controls: { stop: () => void } | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    const handle = async (raw: string) => {
      const code = raw.trim();
      const now = Date.now();
      if (!code || (code === last.current.code && now - last.current.at < 1500)) return;
      last.current = { code, at: now };
      navigator.vibrate?.(60);
      const m = await handler.current(code);
      if (!stopped) setStatus(m || `Lido: ${code}`);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        return setErr('A câmera só funciona em endereço seguro (https). Abra o sistema pelo link https.');
      }
      try {
        const Detector = (window as any).BarcodeDetector;
        if (Detector) {
          const det = new Detector({ formats: FORMATS });
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          if (stopped) return stream.getTracks().forEach((t) => t.stop());
          const v = video.current!;
          v.srcObject = stream;
          await v.play();
          setStatus('Aponte para o código de barras');
          timer = setInterval(async () => {
            if (v.readyState < 2) return;
            try {
              const found = await det.detect(v);
              if (found[0]?.rawValue) void handle(found[0].rawValue);
            } catch { /* quadro sem código */ }
          }, 250);
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          controls = await reader.decodeFromConstraints(
            { video: { facingMode: { ideal: 'environment' } }, audio: false },
            video.current!,
            (result) => { if (result) void handle(result.getText()); },
          );
          setStatus('Aponte para o código de barras');
        }
      } catch (e) {
        const name = (e as Error).name;
        setErr(name === 'NotAllowedError' ? 'Permita o acesso à câmera no navegador e tente de novo.'
          : name === 'NotFoundError' ? 'Nenhuma câmera encontrada.' : `Não foi possível abrir a câmera (${(e as Error).message})`);
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      controls?.stop();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="scanner" role="dialog" aria-label="Leitor de código de barras">
      <video ref={video} playsInline muted />
      <div className="scan-frame" />
      <div className="scan-bar">
        <span>{err || status}</span>
        <button className="primary" onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}
