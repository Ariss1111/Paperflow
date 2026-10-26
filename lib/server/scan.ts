import "server-only";
import net from "node:net";
import fs from "node:fs";
import { env } from "./env";
import { UserError } from "./errors";

export function scannerConfigured(): boolean {
  return !!env.clamavAddress;
}

/** Streams a file to clamd (INSTREAM). No-op when CLAMAV_ADDRESS is unset; fails closed when set but unreachable. */
export async function scanFile(file: string): Promise<void> {
  if (!env.clamavAddress) return;
  const [host, portStr] = env.clamavAddress.split(":");
  const port = Number(portStr || 3310);
  const verdict = await new Promise<string>((resolve, reject) => {
    const sock = net.connect({ host, port });
    let reply = "";
    sock.setTimeout(60_000, () => sock.destroy(new Error("clamd timeout")));
    sock.on("error", reject);
    sock.on("data", (d) => (reply += d.toString()));
    sock.on("close", () => resolve(reply));
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      const rs = fs.createReadStream(file, { highWaterMark: 64 * 1024 });
      rs.on("data", (chunk) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE((chunk as Buffer).length);
        sock.write(len);
        sock.write(chunk);
      });
      rs.on("end", () => sock.write(Buffer.alloc(4)));
      rs.on("error", reject);
    });
  }).catch(() => {
    throw new UserError("The malware scanner is unavailable, so uploads are paused. Try again shortly.", "scanner_unavailable", 503);
  });
  if (/FOUND/.test(verdict)) throw new UserError("This file was flagged by the malware scanner and was deleted.", "malware", 422);
  if (!/OK/.test(verdict)) throw new UserError("The malware scanner couldn't check this file.", "scanner_error", 503);
}
