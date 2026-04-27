/**
 * Ambient shim for the `inngest` SDK.
 *
 * The installed `inngest` package (v3.54) ships only `.d.cts` declaration
 * files, which TypeScript with `moduleResolution: "bundler"` + `module: "esnext"`
 * cannot resolve through Bun's symlinked install path. Rather than rewrite
 * every consumer with `// @ts-expect-error` or downgrade module-resolution
 * project-wide, we declare a minimal but useful surface here.
 *
 * The runtime types are richer (event payload generics, step.run/sleep/etc.)
 * but typing them as `any` here is fine — Inngest validates inputs at runtime
 * via Zod-style schemas, and our handlers are already defensive.
 */

declare module "inngest" {
  export interface InngestFunctionOptions {
    id: string;
    name?: string;
    concurrency?: number | { limit: number; key?: string };
    retries?: number;
    rateLimit?: { limit: number; period: string; key?: string };
    throttle?: { limit: number; period: string; key?: string; burst?: number };
    debounce?: { period: string; key?: string };
    idempotency?: string;
    onFailure?: (...args: any[]) => any;
    [k: string]: any;
  }

  export interface InngestTrigger {
    event?: string;
    cron?: string;
    if?: string;
  }

  /** Args passed to every Inngest function handler. */
  export interface InngestHandlerArgs<TEvent = any> {
    event: TEvent & { name: string; data: any; id?: string; ts?: number };
    events?: Array<TEvent & { name: string; data: any }>;
    step: {
      run<T>(id: string, fn: () => T | Promise<T>): Promise<T>;
      sleep(id: string, duration: string | number): Promise<void>;
      sleepUntil(id: string, until: Date | string): Promise<void>;
      waitForEvent(id: string, opts: { event: string; timeout: string; if?: string; match?: string }): Promise<any>;
      sendEvent(id: string, payload: any | any[]): Promise<{ ids: string[] }>;
      invoke<T = any>(id: string, opts: { function: any; data?: any; user?: any }): Promise<T>;
      [k: string]: any;
    };
    logger: {
      debug: (...args: any[]) => void;
      info: (...args: any[]) => void;
      warn: (...args: any[]) => void;
      error: (...args: any[]) => void;
    };
    runId: string;
    attempt: number;
  }

  export type InngestHandler<TEvent = any> = (args: InngestHandlerArgs<TEvent>) => any | Promise<any>;

  export class Inngest {
    constructor(opts: { id: string; name?: string; eventKey?: string; [k: string]: any });
    createFunction(
      options: InngestFunctionOptions,
      trigger: InngestTrigger | InngestTrigger[],
      handler: InngestHandler,
    ): any;
    send(payload: { name: string; data?: any } | Array<{ name: string; data?: any }>): Promise<{ ids: string[] }>;
  }

  export type EventPayload<T = any> = { name: string; data: T; id?: string; ts?: number };
  export type GetEvents<T = any> = Record<string, EventPayload<T>>;
}

declare module "inngest/next" {
  export function serve(opts: {
    client: import("inngest").Inngest;
    functions: any[];
    signingKey?: string;
    servePath?: string;
    [k: string]: any;
  }): {
    GET: (req: Request) => Promise<Response>;
    POST: (req: Request) => Promise<Response>;
    PUT: (req: Request) => Promise<Response>;
  };
}
