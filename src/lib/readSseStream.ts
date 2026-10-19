export const SSE_DATA_PREFIX = "data: ";

function parseDataLine(line: string): unknown {
  if (!line.startsWith(SSE_DATA_PREFIX)) return undefined;
  try {
    return JSON.parse(line.slice(SSE_DATA_PREFIX.length));
  } catch {
    return undefined;
  }
}

export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onData: (data: unknown) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  const flushLine = (line: string) => {
    const data = parseDataLine(line);
    if (data !== undefined) onData(data);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    lines.forEach(flushLine);
  }
  flushLine(pending);
}
