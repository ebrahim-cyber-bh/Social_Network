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

// Format timestamp to 12-hour format with AM/PM
const formatTime = (isoDate?: string): string => {
  if (!isoDate) return "";
  try {
    const date = new Date(isoDate);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch {
    return "";
  }
};

export default function ChatPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<number | null>(null);
  const [selectedConversationType, setSelectedConversationType] = useState<"group" | "private" | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
          let lastMessageTime = "";
          try {
            const groupMessages = await fetchGroupMessages(group.id, 1, 0);
            if (groupMessages.success && groupMessages.messages.length > 0) {
              const lastMsg = groupMessages.messages[0];
              const senderName = lastMsg.user?.username || "User";
              const msgPreview = lastMsg.content.substring(0, 30);
              lastMessage = `${senderName}: ${msgPreview}${lastMsg.content.length > 30 ? "..." : ""}`;
              lastMessageTime = lastMsg.created_at;
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
            lastMessageTime,
          });
        }

        // Add private chats with last message
        for (const conv of privateConvs) {
          try {
            const messages = await fetchPrivateMessages(conv.id, 1);
            let lastMessage = "No messages yet";
            let lastMessageTime = "";

            if (messages.length > 0) {
              const lastMsg = messages[0];
              const senderName = lastMsg.user.username || "User";
              const msgPreview = lastMsg.content.substring(0, 30);
              lastMessage = `${senderName}: ${msgPreview}${lastMsg.content.length > 30 ? "..." : ""}`;
              lastMessageTime = lastMsg.created_at;
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
              lastMessageTime,
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
              lastMessageTime: "",
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
          const lastMessageTime = data.created_at;
          
          // Move to top and update
          const [conv] = updated.splice(groupIndex, 1);
          updated.unshift({ ...conv, lastMessage, lastMessageTime });
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
          const lastMessageTime = data.created_at;
          
          // Move to top and update
          const [conv] = updated.splice(chatIndex, 1);
          updated.unshift({ ...conv, lastMessage, lastMessageTime });
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

  // Filter conversations based on search query
  const filteredConversations = conversations.filter((conv) =>
    conv.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
          <p className="text-muted-foreground mt-2">Join a group or start a private chat to begin messaging.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 bg-background">
      <div className="grid grid-cols-12 gap-3 h-full items-stretch px-3 py-3 lg:px-4 lg:py-4">
        <aside className="col-span-12 lg:col-span-3 lg:h-full min-h-0 rounded-2xl border border-border bg-white dark:bg-surface p-4 overflow-y-auto flex flex-col shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-foreground">Messages</h2>
            <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              {wsConnected ? <Wifi className="w-2.5 h-2.5 text-green-500" /> : <WifiOff className="w-2.5 h-2.5 text-red-500" />}
            </div>
          </div>
          
          {/* Search Input */}
          <div className="flex items-center gap-2 bg-muted/10 rounded-lg px-3 py-2 mb-4 border border-border">
            <span className="text-muted-foreground text-sm">🔍</span>
            <input
              type="text"
              placeholder="Search contacts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-sm placeholder-muted-foreground text-foreground"
            />
          </div>
          
          <div className="space-y-2 flex-1 overflow-y-auto custom-scrollbar">
            {filteredConversations.map((conversation) => {
              const active = conversation.id === selectedConversationId;
              return (
                <button
                  key={`${conversation.type}-${conversation.id}`}
                  onClick={() => {
                    setSelectedConversationId(conversation.id);
                    setSelectedConversationType(conversation.type);
                  }}
                  className={`w-full text-left p-3 rounded-lg transition-all flex items-center gap-3 min-h-[80px] ${
                    active
                      ? "bg-primary/8 border-l-4 border-primary"
                      : "border-l-4 border-transparent hover:bg-muted/5"
                  }`}
                >
                  {/* Avatar */}
                  <div className="flex-shrink-0">
                    {conversation.avatar ? (
                      <img
                        src={`${API_URL}${conversation.avatar}`}
                        alt={conversation.name}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
                        <CircleUserRound className="w-6 h-6 text-primary" />
                      </div>
                    )}
                  </div>

                  {/* Text content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between items-baseline mb-1">
                      <p className="font-semibold text-sm text-foreground truncate">{conversation.name}</p>
                      <p className="text-xs text-muted-foreground ml-2 whitespace-nowrap">{formatTime(conversation.lastMessageTime)}</p>
                    </div>
                    {conversation.lastMessage && (
                      <p className="text-xs text-muted-foreground truncate">{conversation.lastMessage}</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="col-span-12 lg:col-span-9 flex flex-col min-h-0 overflow-hidden rounded-2xl border border-border bg-white dark:bg-surface shadow-sm">
          {selectedConversation && selectedConversationType === "group" ? (
            <GroupChat
              groupId={selectedConversation.id}
              currentUser={currentUser}
              groupName={selectedConversation.name}
              groupAvatar={selectedConversation.avatar}
              chatType="group"
            />
          ) : selectedConversation && selectedConversationType === "private" ? (
            <div className="rounded-2xl border border-border bg-surface h-full flex flex-col overflow-hidden">
              {/* Profile Header */}
              <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {selectedConversation.avatar ? (
                    <img
                      src={`${API_URL}${selectedConversation.avatar}`}
                      alt={selectedConversation.name}
                      className="w-9 h-9 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-foreground/10 flex items-center justify-center">
                      <CircleUserRound className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <h3 className="text-sm font-bold">{selectedConversation.name}</h3>
                </div>
                <button className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                  View Profile
                </button>
              </div>
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <p className="text-sm font-semibold mb-2">Private chat coming soon</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-border bg-surface h-full flex items-center justify-center text-muted-foreground text-sm">
              Select a conversation to open chat
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
