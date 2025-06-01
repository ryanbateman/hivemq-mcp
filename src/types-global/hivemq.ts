import { z } from "zod";

export const ClientId = z.object({
    id: z.string()
})

export const Clients = z.object({
    items: z.array(ClientId)
  });
