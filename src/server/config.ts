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
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !publicOrigin)
    throw new Error('LAN binding requires HTTPS PUBLIC_ORIGIN');
  return {
    host,
    port: Number(rawPort),
    publicOrigin,
    dataDir: resolve(env.DATA_DIR ?? 'data'),
  };
}
