import { z } from "zod";

export const ClientId = z.object({
    id: z.string()
})

export const Clients = z.object({
    items: z.array(ClientId)
  });

  export const ClientDetails = z.object({
        id: z.string(),
        connected: z.boolean(),
        sessionExpiryInterval: z.number(),
        messageQueueSize: z.number(),
        willPresent: z.boolean()
  });
  