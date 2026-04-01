import { API_URL } from "@/lib/config";
import { PrivateConversation, PrivateChatMessage, ChatConversation } from "./interface";

const CHAT_API_URL = `${API_URL}/api/chats`;

export async function fetchPrivateConversations(): Promise<PrivateConversation[]> {
  try {
    const response = await fetch(`${CHAT_API_URL}/private`, {
      credentials: "include",
    });
    const data = await response.json();
    // Response is an array of conversations
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Error fetching private conversations:", error);
    return [];
  }
}

export async function fetchPrivateMessages(
  conversationId: number,
  limit: number = 5
): Promise<PrivateChatMessage[]> {
  try {
    const response = await fetch(
      `${CHAT_API_URL}/private/${conversationId}/messages?limit=${limit}&offset=0`,
      {
        credentials: "include",
      }
    );
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Error fetching private messages:", error);
    return [];
  }
}

export async function getOrCreatePrivateChat(userId: number): Promise<number> {
  try {
    const response = await fetch(`${CHAT_API_URL}/private/start/${userId}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
    });
    const data = await response.json();
    return data.conversation_id;
  } catch (error) {
    console.error("Error creating private chat:", error);
    throw error;
  }
}
