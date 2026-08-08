export const runtime = "edge";
import { auth } from '@/lib/auth/server';

export const { GET, POST } = auth.handler();
