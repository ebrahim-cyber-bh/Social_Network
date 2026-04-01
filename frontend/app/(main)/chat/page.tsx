"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleUserRound, Loader2, Wifi, WifiOff } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/auth";
import { ServerError } from "@/lib/errors";
import { User, OnlineUser } from "@/lib/interfaces";
import { Group } from "@/lib/groups/interface";
import { fetchGroups } from "@/lib/groups/api";
import { fetchGroupMessages } from "@/lib/groups/chat";
import { fetchPrivateConversations, fetchPrivateMessages } from "@/lib/chat";
import GroupChat from "@/components/groups/GroupChat";
import * as ws from "@/lib/ws/ws";
import { API_URL } from "@/lib/config";

interface Conversation {
  id: number;
  type: "group" | "private";
  name: string;
  avatar?: string;
  lastMessage?: string;
  lastMessageTime?: string;
  groupId?: number;
  otherUserId?: number;
}

export default function ChatPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [selectedConversationType, setSelectedConversationType] = useState<"group" | "private" | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const user = await getCurrentUser();
        if (!user) {
          router.push("/login");
          return;
        }
        setCurrentUser(user);

        // Fetch groups
        const groupsData = await fetchGroups();
        const userGroups = groupsData?.userGroups ?? [];

        // Fetch private conversations
        const privateConvs = await fetchPrivateConversations();

        // Build combined conversation list
        const combinedConversations: Conversation[] = [];

        // Add groups with actual last message
        for (const group of userGroups) {
          let lastMessage = "No messages yet";
          try {
            const groupMessages = await fetchGroupMessages(group.id, 1, 0);
            if (groupMessages.success && groupMessages.messages.length > 0) {
              const lastMsg = groupMessages.messages[0];
              const senderName = lastMsg.user?.username || "User";
              const msgPreview = lastMsg.content.substring(0, 30);
              lastMessage = `${senderName}: ${msgPreview}${lastMsg.content.length > 30 ? "..." : ""}`;
            }
          } catch (error) {
            console.error("Error fetching last message for group", group.id, error);
          }

          combinedConversations.push({
            id: group.id,
            type: "group",
            name: group.name,
            avatar: group.cover_image_path,
            groupId: group.id,
            lastMessage,
          });
        }

        // Add private chats with last message
        for (const conv of privateConvs) {
          try {
            const messages = await fetchPrivateMessages(conv.id, 1);
            let lastMessage = "No messages yet";

            if (messages.length > 0) {
              const lastMsg = messages[0];
              const senderName = lastMsg.user.username || "User";
              const msgPreview = lastMsg.content.substring(0, 30);
              lastMessage = `${senderName}: ${msgPreview}${lastMsg.content.length > 30 ? "..." : ""}`;
            }

            // Get name from other_user if available
            const otherUserName = conv.other_user
              ? `${conv.other_user.first_name} ${conv.other_user.last_name}`
              : `Private Chat #${conv.id}`;

            combinedConversations.push({
              id: conv.id,
              type: "private",
              name: otherUserName,
              avatar: conv.other_user?.avatar,
              lastMessage,
            });
          } catch (error) {
            console.error("Error processing private conversation", conv.id, error);
            // Still add it even if message fetch fails
            const otherUserName = conv.other_user
              ? `${conv.other_user.first_name} ${conv.other_user.last_name}`
              : `Private Chat #${conv.id}`;

            combinedConversations.push({
              id: conv.id,
              type: "private",
              name: otherUserName,
              avatar: conv.other_user?.avatar,
              lastMessage: "No messages yet",
            });
          }
        }

        setConversations(combinedConversations);
        if (combinedConversations.length > 0) {
          setSelectedConversationId(combinedConversations[0].id);
          setSelectedConversationType(combinedConversations[0].type);
        }

        setLoading(false);
      } catch (error) {
        if (error instanceof ServerError) {
          router.push("/error/500");
          return;
        }
        router.push("/login");
      }
    }

    init();
  }, [router]);

  useEffect(() => {
    const handleOnlineUsers = (data: { users: OnlineUser[] }) => {
      setOnlineUsers(data.users ?? []);
    };

    const handleNewGroupMessage = (data: any) => {
      // Update last message for the group
      setConversations((prev) => {
        const updated = [...prev];
        const groupIndex = updated.findIndex((c) => c.type === "group" && c.id === data.group_id);
        if (groupIndex !== -1) {
          const senderName = data.user?.username || "User";
          const msgPreview = data.content?.substring(0, 30) || "";
          const lastMessage = `${senderName}: ${msgPreview}${data.content?.length > 30 ? "..." : ""}`;
          
          // Move to top and update
          const [conv] = updated.splice(groupIndex, 1);
          updated.unshift({ ...conv, lastMessage });
        }
        return updated;
      });
    };

    const handleNewPrivateMessage = (data: any) => {
      // Update last message for the private chat
      setConversations((prev) => {
        const updated = [...prev];
        const chatIndex = updated.findIndex((c) => c.type === "private" && c.id === data.conversation_id);
        if (chatIndex !== -1) {
          const senderName = data.user?.username || "User";
          const msgPreview = data.content?.substring(0, 30) || "";
          const lastMessage = `${senderName}: ${msgPreview}${data.content?.length > 30 ? "..." : ""}`;
          
          // Move to top and update
          const [conv] = updated.splice(chatIndex, 1);
          updated.unshift({ ...conv, lastMessage });
        }
        return updated;
      });
    };

    const handleConnect = () => {
      setWsConnected(true);
      ws.requestOnlineUsers();
    };

    const handleDisconnect = () => {
      setWsConnected(false);
    };

    ws.on("online_users", handleOnlineUsers);
    ws.on("new_group_message", handleNewGroupMessage);
    ws.on("new_private_message", handleNewPrivateMessage);
    ws.onConnect(handleConnect);
    ws.onDisconnect(handleDisconnect);

    setWsConnected(ws.isConnected());
    if (ws.isConnected()) {
      ws.requestOnlineUsers();
    }

    return () => {
      ws.off("online_users", handleOnlineUsers);
      ws.off("new_group_message", handleNewGroupMessage);
      ws.off("new_private_message", handleNewPrivateMessage);
    };
  }, []);

  const selectedConversation = conversations.find((c) => c.id === selectedConversationId) || null;

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!conversations.length) {
    return (
      <div className="p-8">
        <div className="rounded-3xl border border-border bg-surface p-8 text-center">
          <h2 className="text-2xl font-black tracking-tight">No Chats Yet</h2>
          <p className="text-muted mt-2">Join a group or start a private chat to begin messaging.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 p-6 lg:p-8 bg-background">
      <div className="grid grid-cols-12 gap-6 min-h-[calc(100vh-8rem)] lg:h-[calc(100vh-8rem)] items-stretch">
        <aside className="col-span-12 lg:col-span-3 lg:h-full min-h-0 rounded-3xl border border-border bg-surface p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-4 px-2">
            <h2 className="text-sm font-black uppercase tracking-widest text-muted">Chats</h2>
            <div className="flex items-center gap-1 text-xs text-muted">
              {wsConnected ? <Wifi className="w-4 h-4 text-green-500" /> : <WifiOff className="w-4 h-4 text-red-500" />}
              {wsConnected ? "Live" : "Offline"}
            </div>
          </div>
          <div className="space-y-2">
            {conversations.map((conversation) => {
              const active = conversation.id === selectedConversationId;
              return (
                <button
                  key={`${conversation.type}-${conversation.id}`}
                  onClick={() => {
                    setSelectedConversationId(conversation.id);
                    setSelectedConversationType(conversation.type);
                  }}
                  className={`w-full text-left p-3 rounded-2xl border transition-all flex items-center gap-3 ${
                    active
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/30 hover:bg-foreground/5"
                  }`}
                >
                  {/* Avatar */}
                  {conversation.avatar ? (
                    <img
                      src={`${API_URL}${conversation.avatar}`}
                      alt={conversation.name}
                      className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-foreground/10 flex items-center justify-center flex-shrink-0">
                      <CircleUserRound className="w-5 h-5 text-muted" />
                    </div>
                  )}

                  {/* Text content */}
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-sm truncate">{conversation.name}</p>
                    {conversation.lastMessage && (
                      <p className="text-xs text-muted truncate mt-0.5">{conversation.lastMessage}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="col-span-12 lg:col-span-9 flex flex-col min-h-0 h-full overflow-hidden">
          {selectedConversation && selectedConversationType === "group" ? (
            <GroupChat groupId={selectedConversation.id} currentUser={currentUser} />
          ) : selectedConversation && selectedConversationType === "private" ? (
            <div className="rounded-3xl border border-border bg-surface h-full flex items-center justify-center text-muted">
              <div className="text-center">
                <p className="text-lg font-semibold mb-2">Private Chat with {selectedConversation.name}</p>
                <p className="text-sm">Chat component coming soon</p>
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-border bg-surface h-full flex items-center justify-center text-muted">
              Select a conversation to open chat
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
