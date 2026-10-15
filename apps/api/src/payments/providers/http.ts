import { BadGatewayException } from '@nestjs/common';

export async function httpJson<T = any>(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15000);
  try {
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const text = await res.text();
    const data = text ? safeParse(text) : null;
    if (!res.ok) {
      throw new BadGatewayException({ message: 'Erro no gateway de pagamento', status: res.status, gateway: data });
    }
    return data as T;
  } catch (e) {
    if (e instanceof BadGatewayException) throw e;
    throw new BadGatewayException(`Falha ao contatar o gateway: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
