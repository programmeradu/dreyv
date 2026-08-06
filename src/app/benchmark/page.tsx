import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import BenchmarkClient from "./BenchmarkClient";
import BenchmarkGate from "./BenchmarkGate";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Dreyv · Model Benchmark",
  robots: { index: false, follow: false },
};

const COOKIE = "dreyv-benchmark-allow";

async function isUnlocked(): Promise<boolean> {
  const secret = process.env.JWT_SECRET;
  if (!secret) return false;
  const c = await cookies();
  const token = c.get(COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: "keystone-treasury-os",
    });
    return payload.purpose === "benchmark-access";
  } catch {
    return false;
  }
}

export const runtime = "edge";
export default async function BenchmarkPage() {
  const unlocked = await isUnlocked();
  return (
    <main className="min-h-screen bg-white text-slate-900 font-[Manrope,sans-serif]">
      {unlocked ? <BenchmarkClient /> : <BenchmarkGate />}
    </main>
  );
}
