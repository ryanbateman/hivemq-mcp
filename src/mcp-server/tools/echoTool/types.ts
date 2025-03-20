import { z } from 'zod';

/**
 * Valid modes for echo tool operation
 */
export const ECHO_MODES = ['standard', 'uppercase', 'lowercase'] as const;

/**
 * Input schema for the echo tool
 */
export const EchoToolInputSchema = z.object({
  message: z.string().min(1).describe(
    'The message to echo back'
  ),
  mode: z.enum(ECHO_MODES).optional().default('standard').describe(
    'How to format the echoed message: standard (as-is), uppercase, or lowercase'
  ),
  repeat: z.number().int().min(1).max(10).optional().default(1).describe(
    'Number of times to repeat the message (1-10)'
  ),
  timestamp: z.boolean().optional().default(true).describe(
    'Whether to include a timestamp in the response'
  )
});

export type EchoToolInput = z.infer<typeof EchoToolInputSchema>;

/**
 * Response structure for the echo tool
 */
export interface EchoToolResponse {
  originalMessage: string;
  formattedMessage: string;
  repeatedMessage: string;
  timestamp?: string;
  mode: typeof ECHO_MODES[number];
  repeatCount: number;
}