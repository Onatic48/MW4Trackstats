import net from 'node:net';

const host = process.env.API_HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3001);
const timeoutMs = Number(process.env.WAIT_FOR_API_TIMEOUT_MS || 15000);
const retryIntervalMs = 120;
const startedAt = Date.now();

function probePort() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForApi() {
  while (Date.now() - startedAt < timeoutMs) {
    const ready = await probePort();
    if (ready) {
      return;
    }
    await new Promise((r) => setTimeout(r, retryIntervalMs));
  }
  console.warn(`[wait-for-api] Timed out after ${timeoutMs}ms waiting for ${host}:${port}; starting Vite anyway.`);
}

await waitForApi();
