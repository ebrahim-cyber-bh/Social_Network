"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, UserIcon, Smile, X } from "lucide-react";
import { User } from "@/lib/interfaces";
import { PrivateChatMessage } from "@/lib/chat/interface";
import { fetchPrivateMessages } from "@/lib/chat/api";
import { send, on, off } from "@/lib/ws/ws";
import { API_URL } from "@/lib/config";
import { extractImageUrls, renderMessageContent } from "@/lib/utils/message-utils";

interface PrivateChatProps {
  conversationId: number;
  currentUser: User | null;
  otherUserName: string;
  otherUserId?: number;
  otherUserAvatar?: string;
  otherUserUsername?: string;
  isOnline?: boolean;
}

// Emoji categories
const EMOJI_LIST = [
  "😀","😂","😍","🥰","😎","🤔","😅","😭","😊","🤩",
  "👋","👍","👎","❤️","🔥","✨","🎉","💯","🙏","💪",
  "😤","🥲","🤣","😬","🫡","🫶","🤗","😇","🥳","😴",
  "🐶","🐱","🦊","🐻","🦁","🐸","🐧","🦋","🌸","⭐",
  "🍕","🍔","🍦","☕","🍺","🎂","🍟","🌮","🍜","🍣",
  "🏠","🚀","🎵","🎮","📱","💻","🎬","📚","🎨","🏆",
];

const formatTime = (isoDate: string): string => {
  try {
    const date = new Date(isoDate);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
  } catch {
    return "";
  }
};

const LIMIT = 20;
const MAX_MESSAGE_LENGTH = 1000;
const SEND_THROTTLE_MS = 700;
const TYPING_THROTTLE_MS = 900;
const STOP_TYPING_DELAY_MS = 1500;
const REMOTE_TYPING_EXPIRE_MS = 1800;

export default function PrivateChat({
  conversationId,
  currentUser,
  otherUserName,
  otherUserId,
  otherUserAvatar,
  otherUserUsername,
  isOnline,
}: PrivateChatProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<PrivateChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTypingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const lastTypingSentAtRef = useRef(0);
  const lastMessageSentAtRef = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  // Load initial messages
  useEffect(() => {
    setMessages([]);
    setOffset(0);
    setHasMore(true);
    loadInitialMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // WebSocket listeners
  useEffect(() => {
    const handleNewMessage = (data: any) => {
      if (
        data?.type === "new_private_message" &&
        data.conversation_id === conversationId
      ) {
        setMessages((prev) => [...prev, data]);
        // clear typing if it's the other user
        if (data.user_id !== currentUser?.userId) {
          setIsOtherTyping(false);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        }
        scrollToBottom();
      }
    };

    const handleTyping = (data: any) => {
      if (
        data?.type === "user_typing" &&
        typeof data.conversation_id === "number" &&
        data.conversation_id === conversationId &&
        data.user_id !== currentUser?.userId
      ) {
        setIsOtherTyping(true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setIsOtherTyping(false), REMOTE_TYPING_EXPIRE_MS);
      }
    };

    const handleStopTyping = (data: any) => {
      if (
        data?.type === "user_stop_typing" &&
        typeof data.conversation_id === "number" &&
        data.conversation_id === conversationId &&
        data.user_id !== currentUser?.userId
      ) {
        setIsOtherTyping(false);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      }
    };

    on("new_private_message", handleNewMessage);
    on("user_typing", handleTyping);
    on("user_stop_typing", handleStopTyping);

    return () => {
      off("new_private_message", handleNewMessage);
      off("user_typing", handleTyping);
      off("user_stop_typing", handleStopTyping);
    };
  }, [conversationId, currentUser?.userId]);

  // Close emoji picker on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Clear typing on conversationId change
  useEffect(() => {
    setIsOtherTyping(false);
    emitStopTyping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      emitStopTyping();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadInitialMessages = async () => {
    setLoading(true);
    const msgs = await fetchPrivateMessages(conversationId, LIMIT, 0);
    const reversed = [...msgs].reverse();
    setMessages(reversed);
    setOffset(msgs.length);
    setHasMore(msgs.length === LIMIT);
    setTimeout(scrollToBottom, 100);
    setLoading(false);
  };

  const loadMoreMessages = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const container = chatContainerRef.current;
    const oldScrollHeight = container?.scrollHeight || 0;

    const msgs = await fetchPrivateMessages(conversationId, LIMIT, offset);
    if (msgs.length > 0) {
      setOffset((prev) => prev + msgs.length);
      setMessages((prev) => [...msgs.reverse(), ...prev]);
      setHasMore(msgs.length === LIMIT);
      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight - oldScrollHeight;
        }
      });
    } else {
      setHasMore(false);
    }
    setLoadingMore(false);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const emitTyping = (force = false) => {
    const now = Date.now();
    if (!force && now - lastTypingSentAtRef.current < TYPING_THROTTLE_MS) return;
    send({ type: "typing", conversation_id: conversationId });
    isTypingRef.current = true;
    lastTypingSentAtRef.current = now;
  };

  const emitStopTyping = () => {
    if (stopTypingTimeoutRef.current) {
      clearTimeout(stopTypingTimeoutRef.current);
      stopTypingTimeoutRef.current = null;
    }
    if (!isTypingRef.current) return;
    send({ type: "stop_typing", conversation_id: conversationId });
    isTypingRef.current = false;
    lastTypingSentAtRef.current = 0;
  };

  const scheduleStopTyping = () => {
    if (stopTypingTimeoutRef.current) clearTimeout(stopTypingTimeoutRef.current);
    stopTypingTimeoutRef.current = setTimeout(emitStopTyping, STOP_TYPING_DELAY_MS);
  };

  const handleSendMessage = () => {
    if (!currentUser) return;
    const content = newMessage.trim();
    if (!content || content.length > MAX_MESSAGE_LENGTH) return;
    const now = Date.now();
    if (now - lastMessageSentAtRef.current < SEND_THROTTLE_MS) return;
    lastMessageSentAtRef.current = now;

    emitStopTyping();
    send({ type: "private_message", conversation_id: conversationId, content });
    setNewMessage("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.slice(0, MAX_MESSAGE_LENGTH);
    setNewMessage(value);
    if (value.trim()) {
      emitTyping(!isTypingRef.current);
      scheduleStopTyping();
    } else {
      emitStopTyping();
    }
  };

  const handleEmojiClick = (emoji: string) => {
    const input = inputRef.current;
    if (input) {
      const start = input.selectionStart ?? newMessage.length;
      const end = input.selectionEnd ?? newMessage.length;
      const updated = newMessage.slice(0, start) + emoji + newMessage.slice(end);
      setNewMessage(updated.slice(0, MAX_MESSAGE_LENGTH));
      // Restore cursor after emoji
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(start + emoji.length, start + emoji.length);
      }, 0);
    } else {
      setNewMessage((prev) => (prev + emoji).slice(0, MAX_MESSAGE_LENGTH));
    }
  };

  const handleScroll = () => {
    if (chatContainerRef.current?.scrollTop === 0 && hasMore) {
      loadMoreMessages();
    }
  };

  return (
    <div className="flex-1 min-h-0 h-full flex flex-col bg-white dark:bg-surface overflow-hidden">
      {/* Header */}
      <header className="h-16 flex items-center justify-between px-6 bg-surface border-b border-border shrink-0">
        <div
          className="flex items-center gap-3 cursor-pointer hover:opacity-75 transition-opacity"
          onClick={() => otherUserUsername && router.push(`/profile/${otherUserUsername}`)}
        >
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden flex-shrink-0">
            {otherUserAvatar ? (
              <img
                src={`${API_URL}${otherUserAvatar}`}
                alt={otherUserName}
                className="w-full h-full object-cover"
              />
            ) : (
              <UserIcon className="w-5 h-5 text-primary" />
            )}
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground leading-none mb-0.5">{otherUserName}</h3>
            {isOtherTyping ? (
              <p className="text-xs text-primary font-medium">typing...</p>
            ) : isOnline ? (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <p className="text-xs text-muted-foreground font-medium">online</p>
              </div>
            ) : null}
          </div>
        </div>
        <button
          onClick={() => otherUserUsername && router.push(`/profile/${otherUserUsername}`)}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
        >
          View Profile
        </button>
      </header>

      {/* Messages */}
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
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              {otherUserAvatar ? (
                <img src={`${API_URL}${otherUserAvatar}`} alt={otherUserName} className="w-full h-full object-cover rounded-full" />
              ) : (
                <UserIcon className="w-8 h-8 text-primary" />
              )}
            </div>
            <p className="text-base font-bold text-foreground">{otherUserName}</p>
            <p className="text-sm text-muted-foreground">Send a message to start the conversation</p>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isMe = currentUser?.userId === msg.user_id;
            const showDetails =
              index === 0 || messages[index - 1].user_id !== msg.user_id;

            const avatar = msg.user?.avatar;
            const imageUrls = extractImageUrls(msg.content);
            const hasImages = imageUrls.some((item) => item.isImage);

            return (
              <div
                key={msg.id || index}
                className={`w-full flex ${isMe ? "justify-end" : "justify-start"} ${showDetails ? "mt-2" : "mt-0.5"}`}
              >
                <div className={`flex gap-3 ${isMe ? "flex-row-reverse" : ""} max-w-[80%]`}>
                  {/* Avatar for received */}
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

                  {/* Bubble */}
                  <div className={`flex flex-col gap-1 ${isMe ? "items-end" : "items-start"}`}>
                    <div
                      className={`p-3 rounded-xl shadow-sm max-w-full ${
                        isMe
                          ? `bg-primary text-white font-medium shadow-primary/20 ${showDetails ? "rounded-br-none" : ""}`
                          : `bg-muted/8 dark:bg-surface text-muted-foreground border border-border ${showDetails ? "rounded-bl-none" : ""}`
                      }`}
                    >
                      <div className="text-sm leading-relaxed whitespace-normal break-words overflow-wrap-anywhere">
                        {renderMessageContent(msg.content, imageUrls)}
                      </div>

                      {hasImages && (
                        <div className="mt-2 space-y-2">
                          {imageUrls
                            .filter((item) => item.isImage)
                            .map((item, idx) => (
                              <div key={idx} className="rounded-lg overflow-hidden inline-block">
                                <img
                                  src={item.url}
                                  alt="Shared image"
                                  className="max-w-[160px] max-h-[160px] object-cover rounded-lg"
                                  loading="lazy"
                                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                                />
                              </div>
                            ))}
                        </div>
                      )}

                      <p className={`text-[11px] mt-1.5 opacity-70 ${isMe ? "text-white/80" : "text-muted-foreground"}`}>
                        {formatTime(msg.created_at)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Typing indicator */}
        {isOtherTyping && (
          <div className="flex gap-2 items-center mt-2 text-sm text-muted-foreground italic">
            <div className="flex gap-1">
              <span className="inline-block w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="inline-block w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="inline-block w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <span>{otherUserName} is typing...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input footer */}
      <footer className="px-6 py-4 bg-surface border-t border-border shrink-0">
        <div className="relative flex items-center gap-3 bg-muted/10 dark:bg-foreground/10 rounded-xl p-3 border border-border">
          {/* Emoji picker */}
          {showEmojiPicker && (
            <div
              ref={emojiPickerRef}
              className="absolute bottom-full left-0 mb-2 w-72 bg-surface border border-border rounded-xl shadow-xl p-3 z-50"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-muted-foreground">Emojis</span>
                <button
                  onClick={() => setShowEmojiPicker(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-10 gap-1 max-h-36 overflow-y-auto">
                {EMOJI_LIST.map((emoji, i) => (
                  <button
                    key={i}
                    onClick={() => handleEmojiClick(emoji)}
                    className="text-xl w-7 h-7 flex items-center justify-center rounded hover:bg-muted/30 transition-colors"
                    title={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Emoji button */}
          <button
            type="button"
            onClick={() => setShowEmojiPicker((v) => !v)}
            className={`text-muted-foreground hover:text-primary transition-colors flex-shrink-0 ${showEmojiPicker ? "text-primary" : ""}`}
            title="Add emoji"
          >
            <Smile className="w-5 h-5" />
          </button>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex-1 flex items-center gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={newMessage}
              onChange={handleInputChange}
              onBlur={emitStopTyping}
              placeholder={`Message ${otherUserName}...`}
              maxLength={MAX_MESSAGE_LENGTH}
              className="flex-1 bg-transparent border-none focus:outline-none focus:ring-0 text-sm placeholder-muted-foreground dark:placeholder-muted text-foreground dark:text-white py-1"
            />
            <button
              type="submit"
              disabled={!newMessage.trim()}
              className="w-9 h-9 bg-primary text-white rounded-lg flex items-center justify-center hover:bg-primary/80 active:scale-95 transition-all disabled:opacity-50 shadow-md shadow-primary/20 flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </footer>
    </div>
  );
}
