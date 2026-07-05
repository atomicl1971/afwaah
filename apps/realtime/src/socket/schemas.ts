import { z } from "zod";

const uuidSchema = z.string().uuid();

export const roomPayloadSchema = z.object({
  roomId: uuidSchema,
});

export const messageSendPayloadSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  bodyType: z.enum(["text", "image"]).default("text"),
  clientMessageId: uuidSchema,
  mediaAssetId: uuidSchema.optional(),
  replyToMessageId: uuidSchema.optional(),
  roomId: uuidSchema,
});

export const messageReactionPayloadSchema = z.object({
  emoji: z.string().trim().min(1).max(16),
  messageId: uuidSchema,
  remove: z.boolean().optional(),
  roomId: uuidSchema,
});

export const messageDeletePayloadSchema = z.object({
  messageId: uuidSchema,
  roomId: uuidSchema,
});

export const typingPayloadSchema = roomPayloadSchema;
