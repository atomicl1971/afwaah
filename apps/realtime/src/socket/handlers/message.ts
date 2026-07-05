import { MessageService } from "@campus-chat/services/services";
import type { MessageData } from "@campus-chat/services/types";

import type { RealtimeClients } from "../../clients";
import type {
  MessageDeleteResponse,
  MessageDeletedPayload,
  MessageNewPayload,
  MessageReactionResponse,
  MessageReactionUpdatePayload,
  MessageSendResponse,
} from "../../types/events";
import type { RealtimeServer, RealtimeSocket } from "../../types/socket";
import { respondOrEmit } from "../errors";
import type { PresenceManager } from "../presence";
import {
  messageDeletePayloadSchema,
  messageReactionPayloadSchema,
  messageSendPayloadSchema,
} from "../schemas";

export function registerMessageHandlers(
  io: RealtimeServer,
  socket: RealtimeSocket,
  clients: RealtimeClients,
  presenceManager: PresenceManager,
): void {
  const messageService = new MessageService(clients.db, clients.redis);

  socket.on("message:send", async (payload, callback) => {
    try {
      const input = messageSendPayloadSchema.safeParse(payload);
      if (!input.success) {
        respondOrEmit<MessageSendResponse>(socket, callback, {
          error: "Invalid message payload.",
          success: false,
        });
        return;
      }

      const wasJoined = socket.data.rooms.has(input.data.roomId);
      if (socket.data.readOnly) {
        respondOrEmit<MessageSendResponse>(
          socket,
          callback,
          {
            error: "Read-only sessions cannot send messages.",
            success: false,
          },
          "READ_ONLY",
        );
        return;
      }

      const result = await messageService.sendMessage(
        socket.data.userId,
        socket.data.sessionId,
        socket.data.displayName,
        socket.data.displayColor,
        input.data,
      );
      if (!result.ok) {
        respondOrEmit<MessageSendResponse>(
          socket,
          callback,
          {
            error: result.error.message,
            success: false,
          },
          result.error.code,
        );
        return;
      }

      if (result.value.wasCreated && result.value.message) {
        io.to(input.data.roomId).emit(
          "message:new",
          mapMessage(result.value.message),
        );
      }
      void presenceManager
        .removeTypingForSocket(io, socket, input.data.roomId)
        .catch((typingError: unknown) => {
          console.error("Failed to clear typing after message send", {
            error: typingError,
            roomId: input.data.roomId,
            socketId: socket.id,
          });
        });
      if (!wasJoined) {
        joinSocketRoom(socket, input.data.roomId);
      }

      respondOrEmit<MessageSendResponse>(socket, callback, {
        clientMessageId: result.value.clientMessageId,
        createdAt: result.value.createdAt.toISOString(),
        messageId: result.value.messageId,
        success: true,
        wasCreated: result.value.wasCreated,
      });
    } catch (error) {
      console.error("message:send failed", error);
      respondOrEmit<MessageSendResponse>(socket, callback, {
        error: "Failed to send message.",
        success: false,
      });
    }
  });

  socket.on("message:delete", async (payload, callback) => {
    try {
      const input = messageDeletePayloadSchema.safeParse(payload);
      if (!input.success) {
        respondOrEmit<MessageDeleteResponse>(socket, callback, {
          error: "Invalid delete payload.",
          success: false,
        });
        return;
      }

      if (!socket.data.rooms.has(input.data.roomId)) {
        respondOrEmit<MessageDeleteResponse>(socket, callback, {
          error: "Not in room.",
          success: false,
        });
        return;
      }
      if (socket.data.readOnly) {
        respondOrEmit<MessageDeleteResponse>(
          socket,
          callback,
          {
            error: "Read-only sessions cannot delete messages.",
            success: false,
          },
          "READ_ONLY",
        );
        return;
      }

      const currentMessage = await messageService.getMessageById(
        input.data.messageId,
        socket.data.userId,
      );
      if (
        !currentMessage.ok ||
        currentMessage.value.roomId !== input.data.roomId ||
        currentMessage.value.status !== "visible"
      ) {
        respondOrEmit<MessageDeleteResponse>(socket, callback, {
          error: "Message not found.",
          success: false,
        });
        return;
      }

      const result = await messageService.deleteOwnMessage(
        input.data.messageId,
        socket.data.userId,
        socket.data.sessionId,
      );
      if (!result.ok) {
        respondOrEmit<MessageDeleteResponse>(socket, callback, {
          error: result.error.message,
          success: false,
        });
        return;
      }

      const update: MessageDeletedPayload = {
        messageId: input.data.messageId,
        roomId: input.data.roomId,
        userId: socket.data.userId,
      };
      io.to(input.data.roomId).emit("message:deleted", update);

      respondOrEmit<MessageDeleteResponse>(socket, callback, {
        messageId: input.data.messageId,
        roomId: input.data.roomId,
        success: true,
      });
    } catch (error) {
      console.error("message:delete failed", error);
      respondOrEmit<MessageDeleteResponse>(socket, callback, {
        error: "Failed to delete message.",
        success: false,
      });
    }
  });

  socket.on("message:react", async (payload, callback) => {
    try {
      const input = messageReactionPayloadSchema.safeParse(payload);
      if (!input.success) {
        respondOrEmit<MessageReactionResponse>(socket, callback, {
          error: "Invalid reaction payload.",
          success: false,
        });
        return;
      }

      if (!socket.data.rooms.has(input.data.roomId)) {
        respondOrEmit<MessageReactionResponse>(socket, callback, {
          error: "Not in room.",
          success: false,
        });
        return;
      }
      if (socket.data.readOnly) {
        respondOrEmit<MessageReactionResponse>(
          socket,
          callback,
          {
            error: "Read-only sessions cannot react to messages.",
            success: false,
          },
          "READ_ONLY",
        );
        return;
      }

      const currentMessage = await messageService.getMessageById(
        input.data.messageId,
        socket.data.userId,
      );
      if (
        !currentMessage.ok ||
        currentMessage.value.roomId !== input.data.roomId
      ) {
        respondOrEmit<MessageReactionResponse>(socket, callback, {
          error: "Message not found.",
          success: false,
        });
        return;
      }

      const result = input.data.remove
        ? await messageService.removeReaction(
            socket.data.userId,
            socket.data.sessionId,
            input.data.messageId,
            input.data.emoji,
          )
        : await messageService.addReaction(
            socket.data.userId,
            socket.data.sessionId,
            {
              emoji: input.data.emoji,
              messageId: input.data.messageId,
            },
          );
      if (!result.ok) {
        respondOrEmit<MessageReactionResponse>(socket, callback, {
          error: result.error.message,
          success: false,
        });
        return;
      }

      const updatedMessage = await messageService.getMessageById(
        input.data.messageId,
        socket.data.userId,
      );
      if (!updatedMessage.ok) {
        respondOrEmit<MessageReactionResponse>(socket, callback, {
          error: updatedMessage.error.message,
          success: false,
        });
        return;
      }

      const update: MessageReactionUpdatePayload = {
        emoji: input.data.emoji,
        messageId: input.data.messageId,
        reacted: !input.data.remove,
        reactionCounts: updatedMessage.value.reactionCounts,
        roomId: updatedMessage.value.roomId,
        userId: socket.data.userId,
      };

      io.to(update.roomId).emit("message:reaction:update", update);

      respondOrEmit<MessageReactionResponse>(socket, callback, {
        emoji: update.emoji,
        messageId: update.messageId,
        reactionCounts: update.reactionCounts,
        roomId: update.roomId,
        success: true,
      });
    } catch (error) {
      console.error("message:react failed", error);
      respondOrEmit<MessageReactionResponse>(socket, callback, {
        error: "Failed to update reaction.",
        success: false,
      });
    }
  });
}

function mapMessage(message: MessageData): MessageNewPayload {
  return {
    body: message.body,
    bodyType: message.bodyType,
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt.toISOString(),
    displayColor: message.displayColorSnapshot,
    displayName: message.displayNameSnapshot,
    id: message.id,
    mediaAssetId: message.mediaAssetId,
    myReactions: [],
    reactionCounts: message.reactionCounts,
    replyToMessageId: message.replyToMessageId,
    roomId: message.roomId,
    userId: message.userId,
  };
}

function joinSocketRoom(socket: RealtimeSocket, roomId: string): void {
  socket.data.rooms.add(roomId);
  void Promise.resolve(socket.join(roomId)).catch((error: unknown) => {
    socket.data.rooms.delete(roomId);
    console.error("Failed to join socket room after send", {
      error,
      roomId,
      socketId: socket.id,
    });
  });
}
