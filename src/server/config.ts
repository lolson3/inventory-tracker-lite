import { resolve } from 'node:path';
export function config(env: NodeJS.ProcessEnv = process.env) {
  const host = env.HOST ?? '127.0.0.1';
  const rawPort = env.PORT ?? '5174';
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535)
    throw new Error('PORT must be an integer between 1 and 65535');
  const publicOrigin = env.PUBLIC_ORIGIN;
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.origin !== publicOrigin || url.protocol !== 'https:')
      throw new Error('PUBLIC_ORIGIN must be an HTTPS origin without a path');
  }
  const embedOrigin = env.EMBED_ORIGIN ?? '*';
  if (embedOrigin !== '*') {
    const url = new URL(embedOrigin);
    if (
      url.origin !== embedOrigin ||
      !['http:', 'https:'].includes(url.protocol) ||
      /[\s"'`;]/.test(embedOrigin)
    )
      throw new Error(
        'EMBED_ORIGIN must be an HTTP or HTTPS origin without a path',
      );
  }
  return {
    host,
    port: Number(rawPort),
    publicOrigin,
    embedOrigin,
    dataDir: resolve(env.DATA_DIR ?? 'data'),
  };
}
