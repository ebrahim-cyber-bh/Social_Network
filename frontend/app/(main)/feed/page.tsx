"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/auth";
import { ServerError } from "@/lib/errors";
import { User, OnlineUser } from "@/lib/interfaces";
import { API_URL } from "@/lib/config";
import * as ws from "@/lib/ws/ws";
import WebSocketErrorPage from "@/components/layout/WebSocketErrorPage";
import CreatePost from "@/components/feed/CreatePost";
import FeedPostCard from "@/components/feed/FeedPostCard";
import { getFeedPosts, type FeedPost } from "@/lib/posts";
import { fetchGroups } from "@/lib/groups/groups";
import type { Group } from "@/lib/groups/interface";
import { Users, User as UserIcon } from "lucide-react";

async function fetchFollowingIDs(): Promise<Set<number>> {
  try {
    const res = await fetch(`${API_URL}/api/users/following`, {
      credentials: "include",
    });
    const data = await res.json();
    return new Set<number>(data.following_ids ?? []);
  } catch {
    return new Set();
  }
}

export default function FeedPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // All online users from WS — will be filtered to friends only for display
  const [allOnlineUsers, setAllOnlineUsers] = useState<OnlineUser[]>([]);
  const [followingIDs, setFollowingIDs] = useState<Set<number>>(new Set());

  const [wsConnected, setWsConnected] = useState(false);
  const [showErrorPage, setShowErrorPage] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);

  const [myGroups, setMyGroups] = useState<Group[]>([]);
  const [suggestedGroups, setSuggestedGroups] = useState<Group[]>([]);

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

  // ── Load data once authenticated ──
  useEffect(() => {
    if (!user) return;
    loadPosts();

    // Groups: split into my groups vs suggested (not joined)
    fetchGroups().then((data) => {
      if (!data) return;
      setMyGroups(data.userGroups.slice(0, 5));
      setSuggestedGroups(
        data.allGroups
          .filter((g) => !data.userGroups.some((ug) => ug.id === g.id))
          .slice(0, 4),
      );
    });

    // Following IDs for filtering online friends
    fetchFollowingIDs().then(setFollowingIDs);
  }, [user, loadPosts]);

  // ── WebSocket ──
  useEffect(() => {
    if (!user) return;

    const handleOnlineUsers = (data: { users: OnlineUser[] }) => {
      setAllOnlineUsers(
        (data.users || []).filter((u) => u.userId !== user.userId && u.online),
      );
    };
    const handleConnect = () => {
      setWsConnected(true);
      setShowErrorPage(false);
      setReconnectAttempts(0);
      ws.requestOnlineUsers();
    };
    const handleDisconnect = () => {
      setWsConnected(false);
      setReconnectAttempts(ws.getReconnectAttempts());
    };
    const handleMaxRetries = () => setShowErrorPage(true);

    ws.on("online_users", handleOnlineUsers);
    ws.onConnect(handleConnect);
    ws.onDisconnect(handleDisconnect);
    ws.onMaxRetriesReached(handleMaxRetries);
    setWsConnected(ws.isConnected());
    if (ws.isConnected()) ws.requestOnlineUsers();

    return () => { ws.off("online_users", handleOnlineUsers); };
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

  // Only show users the current user follows
  const onlineFriends = allOnlineUsers.filter((u) => followingIDs.has(u.userId));

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* ── Centre: scrollable feed ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
          <CreatePost user={user} onPostCreated={loadPosts} />

          {postsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="border border-border rounded-xl bg-background p-4 animate-pulse"
                >
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
            <div className="border border-border rounded-xl bg-background p-10 text-center">
              <p className="text-foreground/40 text-sm">
                No posts yet. Be the first to post something!
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {posts.map((post) => (
                <FeedPostCard
                  key={post.id}
                  post={post}
                  currentUserId={user.userId ?? 0}
                  onDeleted={(id) =>
                    setPosts((prev) => prev.filter((p) => p.id !== id))
                  }
                  onUpdated={(id, content, privacy) =>
                    setPosts((prev) =>
                      prev.map((p) =>
                        p.id === id
                          ? { ...p, content, privacy: privacy as FeedPost["privacy"] }
                          : p,
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
      <aside className="hidden lg:flex flex-col w-72 shrink-0 border-l border-border overflow-y-auto p-4 space-y-8 bg-background">

        {/* Online Friends */}
        <div>
          <h3 className="text-[11px] font-bold text-foreground/40 uppercase tracking-widest mb-4">
            Online Friends
            {!wsConnected && <span className="ml-2 text-red-400">· offline</span>}
          </h3>

          {onlineFriends.length === 0 ? (
            <p className="text-xs text-foreground/30 py-2">No friends online</p>
          ) : (
            <div className="space-y-3">
              {onlineFriends.map((u) => (
                <div key={u.userId} className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    {u.avatar ? (
                      <img
                        src={`${API_URL}${u.avatar}`}
                        alt={u.firstName}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-foreground/10 flex items-center justify-center border border-border">
                        <UserIcon className="w-4 h-4 text-foreground/40" />
                      </div>
                    )}
                    <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-background rounded-full" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {u.firstName} {u.lastName}
                    </p>
                    {u.username && (
                      <p className="text-xs text-foreground/40 truncate">@{u.username}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active Groups */}
        {myGroups.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] font-bold text-foreground/40 uppercase tracking-widest">
                Active Groups
              </h3>
              <Link href="/groups" className="text-[11px] text-primary hover:underline font-medium">
                See all
              </Link>
            </div>
            <div className="space-y-1">
              {myGroups.map((g) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}`}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-foreground/5 transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                    {g.cover_image_path ? (
                      <img
                        src={`${API_URL}${g.cover_image_path}`}
                        alt={g.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Users className="w-4 h-4 text-primary" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{g.name}</p>
                    {g.members_count !== undefined && (
                      <p className="text-[11px] text-foreground/40">
                        {g.members_count.toLocaleString()} members
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Suggested Groups */}
        {suggestedGroups.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[11px] font-bold text-foreground/40 uppercase tracking-widest">
                Suggested Groups
              </h3>
              <Link href="/groups" className="text-[11px] text-primary hover:underline font-medium">
                See all
              </Link>
            </div>
            <div className="space-y-1">
              {suggestedGroups.map((g) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}`}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-foreground/5 transition-colors group"
                >
                  <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center shrink-0 overflow-hidden border border-border">
                    {g.cover_image_path ? (
                      <img
                        src={`${API_URL}${g.cover_image_path}`}
                        alt={g.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Users className="w-4 h-4 text-foreground/40" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{g.name}</p>
                    {g.members_count !== undefined && (
                      <p className="text-[11px] text-foreground/40">
                        {g.members_count.toLocaleString()} members
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

      </aside>
    </div>
  );
}
