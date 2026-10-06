// React Native supports AbortController, but not AbortSignal.timeout on all engines.
// Keep the deadline active until the response body has also been read.
export async function fetchJson(
  url: string,
  options: Omit<RequestInit, 'signal'> = {},
  timeoutMs = 20000
): Promise<{ response: Response; value: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data: unknown = await response.json().catch(error => {
      if (controller.signal.aborted) throw error;
      return {};
    });
    const value = data && typeof data === 'object' && !Array.isArray(data)
      ? data as Record<string, unknown> : {};
    return { response, value };
  } catch {
    throw new Error(controller.signal.aborted
      ? 'Request timed out. Check your connection and try again.'
      : 'Could not connect to tracking. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
}
