"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/auth";
import { ServerError } from "@/lib/errors";
import { User } from "@/lib/interfaces";
import * as ws from "@/lib/ws/ws";
import WebSocketErrorPage from "@/components/layout/WebSocketErrorPage";
import CreatePost from "@/components/feed/CreatePost";
import FeedPostCard from "@/components/feed/FeedPostCard";
import FeedSidebar from "@/components/feed/FeedSidebar";
import { getFeedPosts, type FeedPost } from "@/lib/posts";

export default function FeedPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showErrorPage, setShowErrorPage] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);

  const loadPosts = useCallback(async () => {
    setPostsLoading(true);
    try {
      setPosts(await getFeedPosts());
    } catch {
      /* silently fail */
    } finally {
      setPostsLoading(false);
    }
  }, []);

  // ── Auth check ──
  useEffect(() => {
    async function checkAuth() {
      try {
        const currentUser = await getCurrentUser();
        if (!currentUser) { router.push("/login"); return; }
        setUser(currentUser);
        setLoading(false);
      } catch (error) {
        router.push(error instanceof ServerError ? "/error/500" : "/login");
      }
    }
    checkAuth();
  }, [router]);

  // ── Load posts once authenticated ──
  useEffect(() => {
    if (!user) return;
    loadPosts();
  }, [user, loadPosts]);

  // ── WebSocket error tracking ──
  useEffect(() => {
    if (!user) return;
    const handleConnect = () => { setShowErrorPage(false); setReconnectAttempts(0); };
    const handleDisconnect = () => setReconnectAttempts(ws.getReconnectAttempts());
    const handleMaxRetries = () => setShowErrorPage(true);
    ws.onConnect(handleConnect);
    ws.onDisconnect(handleDisconnect);
    ws.onMaxRetriesReached(handleMaxRetries);
  }, [user]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-foreground/40 text-sm">Loading...</p>
      </div>
    );
  }
  if (!user) return null;
  if (showErrorPage) {
    return (
      <WebSocketErrorPage
        onRetry={() => window.location.reload()}
        isReconnecting={false}
        reconnectAttempts={reconnectAttempts}
        maxAttempts={ws.getMaxReconnectAttempts()}
      />
    );
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* ── Centre: scrollable feed ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          <CreatePost user={user} onPostCreated={loadPosts} />

          {postsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="border border-border rounded-xl bg-surface p-4 animate-pulse">
                  <div className="flex gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-foreground/10" />
                    <div className="flex-1 space-y-2 pt-1">
                      <div className="h-3 bg-foreground/10 rounded w-32" />
                      <div className="h-2 bg-foreground/10 rounded w-20" />
                    </div>
                  </div>
                  <div className="h-3 bg-foreground/10 rounded w-full mb-2" />
                  <div className="h-3 bg-foreground/10 rounded w-3/4" />
                </div>
              ))}
            </div>
          ) : posts.length === 0 ? (
            <div className="border border-border rounded-xl bg-surface p-10 text-center">
              <p className="text-foreground/40 text-sm">No posts yet. Be the first to post something!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <FeedPostCard
                  key={post.id}
                  post={post}
                  currentUserId={user.userId ?? 0}
                  onDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
                  onUpdated={(id, content, privacy) =>
                    setPosts((prev) =>
                      prev.map((p) =>
                        p.id === id ? { ...p, content, privacy: privacy as FeedPost["privacy"] } : p,
                      ),
                    )
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right sidebar ── */}
      <FeedSidebar currentUserId={user.userId ?? 0} />
    </div>
  );
}
