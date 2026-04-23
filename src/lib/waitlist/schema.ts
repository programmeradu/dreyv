import { z } from "zod";
import {
  WAITLIST_ROLES,
  WAITLIST_ORG_TYPES,
  WAITLIST_CHAINS,
  WAITLIST_AUM_BANDS,
  WAITLIST_REFERRAL_SOURCES,
} from "./constants";

const enumValues = <T extends ReadonlyArray<{ value: string }>>(arr: T) =>
  arr.map((o) => o.value) as [string, ...string[]];

export const waitlistSubmissionSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  name: z.string().trim().max(100).optional().or(z.literal("")),
  organization: z.string().trim().max(120).optional().or(z.literal("")),
  role: z.enum(enumValues(WAITLIST_ROLES)).optional(),
  orgType: z.enum(enumValues(WAITLIST_ORG_TYPES)).optional(),
  chains: z
    .array(z.enum(enumValues(WAITLIST_CHAINS)))
    .max(3)
    .optional(),
  currentStack: z.string().trim().max(280).optional().or(z.literal("")),
  aumBand: z.enum(enumValues(WAITLIST_AUM_BANDS)).optional(),
  useCase: z.string().trim().max(500).optional().or(z.literal("")),
  referralSource: z.enum(enumValues(WAITLIST_REFERRAL_SOURCES)).optional(),
});

export type WaitlistSubmission = z.infer<typeof waitlistSubmissionSchema>;
