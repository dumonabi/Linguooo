import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function isVercelRuntime() {
  return process.env.VERCEL === '1';
}

export function getLocalDataRoot() {
  return path.join(__dirname, '..', 'data');
}

export function getRuntimeDataRoot() {
  if (isVercelRuntime()) return '/tmp/lingu-data';
  return getLocalDataRoot();
}

export function getUserRegistryPath() {
  const override = process.env.USER_REGISTRY_PATH?.trim();
  if (override) return override;
  return path.join(getRuntimeDataRoot(), 'users', 'registry.json');
}

export function getVoiceDataRoot() {
  const override = process.env.VOICE_DATA_DIR?.trim();
  if (override) return override;
  return path.join(getRuntimeDataRoot(), 'voices');
}
