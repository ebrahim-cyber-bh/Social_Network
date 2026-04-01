import { useState, useEffect, useRef } from "react";
import { Send, Loader2, UserIcon } from "lucide-react";
import { User } from "@/lib/interfaces";
import { GroupChatMessage } from "@/lib/groups/interface";
import { fetchGroupMessages } from "@/lib/groups/api";
import { send, on, off } from "@/lib/ws/ws";
import { API_URL } from "@/lib/config";
import { extractImageUrls, renderMessageContent } from "@/lib/utils/message-utils";

interface GroupChatProps {
  groupId: number;
  currentUser: User | null;
}

export default function GroupChat({ groupId, currentUser }: GroupChatProps) {
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [typingUsers, setTypingUsers] = useState<Map<number, string>>(new Map());
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
    loadInitialMessages();
  }, [groupId]);

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
    <div className="flex-1 min-h-0 h-full flex flex-col bg-surface rounded-3xl border border-border overflow-hidden glass relative">
      {/* Group Chat Header */}
      <div className="p-6 border-b border-border flex items-center justify-between">
        <h3 className="text-lg font-bold">Group Chat</h3>
      </div>

      {/* Chat Messages */}
      <div
        ref={chatContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-scroll overflow-x-hidden p-6 space-y-1"
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
                className={`w-full flex ${isMe ? "justify-end" : "justify-start"} ${showDetails ? "mt-4" : "mt-1"}`}
              >
                <div className={`flex min-w-0 max-w-[85%] gap-3 ${isMe ? "flex-row-reverse" : ""}`}>
                  <div className={`shrink-0 ${!showDetails ? "w-10" : ""}`}>
                    {showDetails && (
                      <div className="w-10 h-10 rounded-xl bg-muted/20 border border-border flex items-center justify-center overflow-hidden">
                        {avatar ? (
                          <img src={`${API_URL}${avatar}`} alt="Avatar" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-muted-foreground font-bold text-xs uppercase">
                          <UserIcon className="h-6 w-6 text-muted-foreground" />
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className={`flex flex-col min-w-0 max-w-full ${isMe ? "items-end" : "items-start"}`}>
                    {showDetails && (
                      <div className="flex items-baseline gap-2 mb-1 max-w-full">
                        {isMe ? (
                          <>
                            <span className="text-[10px] text-muted-foreground font-medium">
                              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="text-sm font-bold">You</span>
                          </>
                        ) : (
                          <>
                            <span className="text-sm font-bold shrink-0">{username}</span>
                            <span className="text-[10px] text-muted-foreground font-medium shrink-0">
                              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </>
                        )}
                      </div>
                    )}
                    <div
                      className={`w-fit min-w-0 max-w-full overflow-hidden ${hasImages ? 'p-2' : 'p-4'} text-sm leading-relaxed ${
                        isMe
                          ? `bg-primary text-black font-semibold shadow-lg shadow-primary/20 ${showDetails ? 'rounded-2xl rounded-tr-none' : 'rounded-2xl'}`
                          : `bg-muted/10 text-foreground border border-border ${showDetails ? 'rounded-2xl rounded-tl-none' : 'rounded-2xl'}`
                      }`}
                    >
                      <div className={`whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:break-word] ${hasImages ? 'px-2 pt-2' : ''}`}>
                        {renderMessageContent(msg.content, imageUrls)}
                      </div>

                      {/* Render images inline */}
                      {hasImages && (
                        <div className="mt-2 space-y-2">
                          {imageUrls
                            .filter(item => item.isImage)
                            .map((item, idx) => (
                              <div
                                key={idx}
                                className={`rounded-xl overflow-hidden inline-block ${isMe ? 'bg-black/10' : 'bg-surface/50'}`}
                              >
                                <img
                                  src={item.url}
                                  alt="Shared image"
                                  className="max-w-[120px] max-h-[120px] object-cover rounded-xl"
                                  loading="lazy"
                                  onError={(e) => {
                                    // Hide image if it fails to load
                                    e.currentTarget.style.display = 'none';
                                  }}
                                />
                              </div>
                            ))
                          }
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        
        {/* Typing Indicator */}
        {typingUsers.size > 0 && (
          <div className="flex gap-2 items-center px-2 py-2 text-sm text-muted-foreground italic">
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
      <div className="p-6 bg-transparent">
        <form 
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="relative"
        >
          <input
            type="text"
            value={newMessage}
            onChange={handleInputChange}
            onBlur={emitStopTyping}
            placeholder="Type a message..."
            maxLength={MAX_MESSAGE_LENGTH}
            className="w-full bg-muted/5 border border-border rounded-2xl py-4 pl-6 pr-16 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary placeholder-muted-foreground text-sm transition-all text-foreground"
          />
          <div className="absolute inset-y-0 right-3 flex items-center">
            <button
              type="submit"
              disabled={!newMessage.trim()}
              className="w-10 h-10 bg-primary text-black rounded-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-all disabled:opacity-50 disabled:scale-100 shadow-md shadow-primary/10"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}