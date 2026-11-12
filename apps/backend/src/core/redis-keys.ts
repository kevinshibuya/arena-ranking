import { Redis } from 'ioredis';

/** Deletes every key under `<prefix>:`. Test and smoke runs clean up with it. */
export async function deleteKeysWithPrefix(url: string, prefix: string): Promise<void> {
  const redis = new Redis(url);
  try {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    await redis.quit();
  }
}
