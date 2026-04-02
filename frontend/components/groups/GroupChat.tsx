import { useState, useEffect, useRef } from "react";
import { Send, Loader2, UserIcon } from "lucide-react";
import { User } from "@/lib/interfaces";
import { GroupChatMessage } from "@/lib/groups/interface";
import { fetchGroupMessages, fetchGroupDetail } from "@/lib/groups/api";
import { send, on, off } from "@/lib/ws/ws";
import { API_URL } from "@/lib/config";
import { extractImageUrls, renderMessageContent } from "@/lib/utils/message-utils";

interface GroupChatProps {
  groupId: number;
  currentUser: User | null;
  groupName?: string;
  groupAvatar?: string;
  chatType?: "group" | "private";
}

// Format timestamp to 12-hour format with AM/PM
const formatTime = (isoDate: string): string => {
  try {
    const date = new Date(isoDate);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch {
    return "";
  }
};

export default function GroupChat({ groupId, currentUser, groupName = "Group Chat", groupAvatar, chatType = "group" }: GroupChatProps) {
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [typingUsers, setTypingUsers] = useState<Map<number, string>>(new Map());
  const [groupInfo, setGroupInfo] = useState<any>(null);
  const [groupInfoLoading, setGroupInfoLoading] = useState(false);
  const typingTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const stopTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const lastTypingSentAtRef = useRef(0);
  const lastMessageSentAtRef = useRef(0);

  const LIMIT = 10;
  const MAX_MESSAGE_LENGTH = 1000;
  const SEND_THROTTLE_MS = 700;
  const TYPING_THROTTLE_MS = 900;
  const STOP_TYPING_DELAY_MS = 1500;
  const REMOTE_TYPING_EXPIRE_MS = 1800;

  useEffect(() => {
    // Fetch group details if not provided
    if (!groupName || !groupAvatar) {
      setGroupInfoLoading(true);
      fetchGroupDetail(groupId).then((detail) => {
        if (detail?.success && detail?.group) {
          setGroupInfo(detail.group);
        }
        setGroupInfoLoading(false);
      });
    }
    loadInitialMessages();
  }, [groupId, groupName, groupAvatar]);

  useEffect(() => {
    // Listen for new messages
    const handleNewMessage = (data: any) => {
      if (
        data?.type === "new_group_message" &&
        typeof data.group_id === "number" &&
        typeof data.user_id === "number" &&
        typeof data.content === "string" &&
        data.group_id === groupId
      ) {
        setMessages((prev) => [...prev, data]);
        // Remove sender from typing indicators as soon as their message arrives
        const existingTimeout = typingTimeoutsRef.current.get(data.user_id);
        if (existingTimeout) {
          clearTimeout(existingTimeout);
          typingTimeoutsRef.current.delete(data.user_id);
        }
        setTypingUsers((prev) => {
          if (!prev.has(data.user_id)) return prev;
          const updated = new Map(prev);
          updated.delete(data.user_id);
          return updated;
        });
        scrollToBottom();
      }
    };

    // Listen for typing events
    const handleUserTyping = (data: any) => {
      if (
        data &&
        typeof data.group_id === "number" &&
        typeof data.user_id === "number" &&
        data.group_id === groupId &&
        data.user_id !== currentUser?.userId
      ) {
        const existingTimeout = typingTimeoutsRef.current.get(data.user_id);
        if (existingTimeout) clearTimeout(existingTimeout);

        const timeout = setTimeout(() => {
          typingTimeoutsRef.current.delete(data.user_id);
          setTypingUsers((prev) => {
            if (!prev.has(data.user_id)) return prev;
            const updated = new Map(prev);
            updated.delete(data.user_id);
            return updated;
          });
        }, REMOTE_TYPING_EXPIRE_MS);

        typingTimeoutsRef.current.set(data.user_id, timeout);
        const name = data.user_name || "Someone";
        setTypingUsers((prev) => {
          if (prev.get(data.user_id) === name) return prev;
          const updated = new Map(prev);
          updated.set(data.user_id, name);
          return updated;
        });
      }
    };

    const handleUserStopTyping = (data: any) => {
      if (
        !data ||
        typeof data.group_id !== "number" ||
        typeof data.user_id !== "number" ||
        data.group_id !== groupId
      ) {
        return;
      }

      const existingTimeout = typingTimeoutsRef.current.get(data.user_id);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        typingTimeoutsRef.current.delete(data.user_id);
      }

      setTypingUsers((prev) => {
        if (!prev.has(data.user_id)) return prev;
        const updated = new Map(prev);
        updated.delete(data.user_id);
        return updated;
      });
    };

    on("new_group_message", handleNewMessage);
    on("user_typing", handleUserTyping);
    on("user_stop_typing", handleUserStopTyping);
    return () => {
      off("new_group_message", handleNewMessage);
      off("user_typing", handleUserTyping);
      off("user_stop_typing", handleUserStopTyping);
    };
  }, [groupId, currentUser?.userId]);

  useEffect(() => {
    // Switching groups should immediately clear stale typing indicators.
    typingTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    typingTimeoutsRef.current.clear();
    setTypingUsers(new Map());
  }, [groupId]);

  const loadInitialMessages = async () => {
    setLoading(true);
    const result = await fetchGroupMessages(groupId, LIMIT, 0);
    if (result.success && result.messages) {
      // API returns newest first (DESC), so we reverse to show oldest at top for chat
      setMessages(result.messages.reverse());
      setOffset(result.messages.length);
      setHasMore(result.messages.length === LIMIT);
      scrollToBottom();
    }
    setLoading(false);
  };

  const loadMoreMessages = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    
    // Remember scroll position
    const container = chatContainerRef.current;
    const oldScrollHeight = container?.scrollHeight || 0;

    const result = await fetchGroupMessages(groupId, LIMIT, offset);
    if (result.success && result.messages) {
      if (result.messages.length < LIMIT) {
        setHasMore(false);
      }
      setOffset((prev) => prev + result.messages.length);
      setMessages((prev) => [...result.messages.reverse(), ...prev]);
      
      // Restore scroll position
      requestAnimationFrame(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop = newScrollHeight - oldScrollHeight;
        }
      });
    }
    setLoadingMore(false);
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  const emitTyping = (force = false) => {
    const now = Date.now();
    const shouldSend = force || now - lastTypingSentAtRef.current >= TYPING_THROTTLE_MS;
    if (!shouldSend) return;

    send({
      type: "typing",
      group_id: groupId,
    });

    isTypingRef.current = true;
    lastTypingSentAtRef.current = now;
  };

  const emitStopTyping = () => {
    if (stopTypingTimeoutRef.current) {
      clearTimeout(stopTypingTimeoutRef.current);
      stopTypingTimeoutRef.current = null;
    }

    if (!isTypingRef.current) return;

    send({
      type: "stop_typing",
      group_id: groupId,
    });

    isTypingRef.current = false;
    lastTypingSentAtRef.current = 0;
  };

  const scheduleStopTyping = () => {
    if (stopTypingTimeoutRef.current) {
      clearTimeout(stopTypingTimeoutRef.current);
    }

    stopTypingTimeoutRef.current = setTimeout(() => {
      emitStopTyping();
    }, STOP_TYPING_DELAY_MS);
  };

  const handleSendMessage = () => {
    if (!currentUser) return;

    const content = newMessage.trim();
    if (!content) return;
    if (content.length > MAX_MESSAGE_LENGTH) return;

    const now = Date.now();
    if (now - lastMessageSentAtRef.current < SEND_THROTTLE_MS) return;
    lastMessageSentAtRef.current = now;

    // Send via WebSocket
    emitStopTyping();

    send({
      type: "group_message",
      group_id: groupId,
      content,
    });

    setNewMessage("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.slice(0, MAX_MESSAGE_LENGTH);
    setNewMessage(value);

    if (value.trim()) {
      // First keypress sends immediately, subsequent keypresses are throttled.
      emitTyping(!isTypingRef.current);
      scheduleStopTyping();
    } else {
      emitStopTyping();
    }
  };

  useEffect(() => {
    return () => {
      typingTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      typingTimeoutsRef.current.clear();
      emitStopTyping();
    };
  }, [groupId]);

  const handleScroll = () => {
    if (chatContainerRef.current) {
      const { scrollTop } = chatContainerRef.current;
      if (scrollTop === 0 && hasMore) {
        loadMoreMessages();
      }
    }
  };

  return (
    <div className="flex-1 min-h-0 h-full flex flex-col bg-white dark:bg-surface overflow-hidden">
      {/* Group Profile Header */}
      <header className="h-16 flex items-center justify-between px-6 bg-surface border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 overflow-hidden">
            {groupAvatar || groupInfo?.cover_image_path ? (
              <img
                src={`${API_URL}${groupAvatar || groupInfo?.cover_image_path}`}
                alt="Group avatar"
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-sm font-bold text-primary">G</span>
            )}
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground leading-none mb-0.5">{groupName || groupInfo?.name || "Group Chat"}</h3>
            {chatType === "private" && (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                <p className="text-xs text-muted font-medium">Active</p>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors">View Profile</button>
          <div className="h-6 w-[1px] bg-border"></div>
          <button className="text-muted hover:text-primary transition-colors">📄</button>
        </div>
      </header>

      {/* Chat Messages */}
      <div
        ref={chatContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 py-6 flex flex-col gap-1 bg-background"
        style={{ scrollbarGutter: "stable" }}
      >
        {loadingMore && (
          <div className="flex justify-center p-2">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        )}
        
        {loading && messages.length === 0 ? (
           <div className="flex justify-center items-center h-full">
             <Loader2 className="w-8 h-8 animate-spin text-muted" />
           </div>
        ) : (
          messages.map((msg, index) => {
            const isMe = currentUser?.userId === msg.user_id;
            const showDetails = index === 0 || messages[index - 1].user_id !== msg.user_id;
            
            // Get user details from message
            const user = msg.user;
            const avatar = user?.avatar;
            const username = user?.username || 'User';
            
            // Extract image URLs from message
            const imageUrls = extractImageUrls(msg.content);
            const hasImages = imageUrls.some(item => item.isImage);

            return (
              <div
                key={msg.id || index}
                className={`w-full flex ${isMe ? "justify-end" : "justify-start"} ${showDetails ? "mt-2" : "mt-0.5"}`}
              >
                <div className={`flex gap-3 ${isMe ? "flex-row-reverse" : ""} max-w-[80%]`}>
                  {/* Avatar - only for received messages */}
                  {!isMe && (
                    <div className="flex-shrink-0 w-8 h-8 mt-auto">
                      {showDetails ? (
                        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
                          {avatar ? (
                            <img src={`${API_URL}${avatar}`} alt="Avatar" className="w-full h-full object-cover" />
                          ) : (
                            <UserIcon className="h-4 w-4 text-primary" />
                          )}
                        </div>
                      ) : (
                        <div className="w-8 h-8" />
                      )}
                    </div>
                  )}
                  
                  {/* Content: Username/Time + Bubble */}
                  <div className={`flex flex-col gap-1 ${isMe ? "items-end" : "items-start"}`}>
                    {showDetails && (
                      <div className={`text-xs font-semibold text-muted-foreground mb-0.5 px-1 ${isMe ? "text-right" : "text-left"}`}>
                        {!isMe && username}
                      </div>
                    )}
                    {/* Message Bubble */}
                    <div
                      className={`p-3 rounded-xl shadow-sm max-w-[100%] ${
                        isMe
                          ? `bg-primary text-white font-medium shadow-primary/20 ${showDetails ? 'rounded-br-none' : ''}`
                          : `bg-muted/8 dark:bg-surface text-muted-foreground border border-border dark:border-border ${showDetails ? 'rounded-bl-none' : ''}`
                      }`}
                    >
                      <div className="text-sm leading-relaxed whitespace-normal break-words overflow-wrap-anywhere">
                        {renderMessageContent(msg.content, imageUrls)}
                      </div>

                      {/* Render images inline */}
                      {hasImages && (
                        <div className="mt-2 space-y-2">
                          {imageUrls
                            .filter(item => item.isImage)
                            .map((item, idx) => (
                              <div key={idx} className="rounded-lg overflow-hidden inline-block">
                                <img
                                  src={item.url}
                                  alt="Shared image"
                                  className="max-w-[160px] max-h-[160px] object-cover rounded-lg"
                                  loading="lazy"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                  }}
                                />
                              </div>
                            ))}
                        </div>
                      )}

                      {/* Timestamp */}
                      <p className={`text-[11px] mt-1.5 opacity-70 ${
                        isMe ? "text-white/80" : "text-muted-foreground"
                      }`}>
                        {formatTime(msg.created_at)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        
        {/* Typing Indicator */}
        {typingUsers.size > 0 && (
          <div className="flex gap-2 items-center mt-2 text-sm text-muted-foreground italic font-normal">
            <div className="flex gap-1">
              <span className="inline-block w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="inline-block w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="inline-block w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
            <span>
              {Array.from(typingUsers.values())
                .map((name) => name)
                .join(", ")} {typingUsers.size === 1 ? "is" : "are"} typing...
            </span>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Chat Input */}
      <footer className="px-6 py-4 bg-surface border-t border-border shrink-0">
        <div className="flex items-center gap-3 bg-muted/10 dark:bg-foreground/10 rounded-xl p-3 border border-border">
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex-1 flex items-center gap-2"
          >
            <input
              type="text"
              value={newMessage}
              onChange={handleInputChange}
              onBlur={emitStopTyping}
              placeholder="Type a message..."
              maxLength={MAX_MESSAGE_LENGTH}
              className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-sm placeholder-muted-foreground dark:placeholder-muted text-foreground dark:text-white py-1"
            />
            <button
              type="submit"
              disabled={!newMessage.trim()}
              className="w-9 h-9 bg-primary text-white rounded-lg flex items-center justify-center hover:bg-blue-600 active:scale-95 transition-all disabled:opacity-50 shadow-md shadow-primary/20 flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
}