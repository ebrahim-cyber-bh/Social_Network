"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Settings,
  Mail,
  Cake,
  ShieldCheck,
  Users,
  Globe,
  Lock,
  Loader2,
  Search,
  UserIcon,
  ArrowLeft,
  Heart,
  MessageSquare,
  Share2,
  Activity,
  FileText,
  Zap,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth/auth";
import { updateProfile } from "@/lib/auth/update";
import {
  followUser,
  unfollowUser,
  getFollowers,
  getFollowing,
} from "@/lib/users/follow";
import { fetchUserProfile } from "@/lib/users/profile";
import type { PublicProfile } from "@/lib/users/profile";
import { getUserPosts, toggleLike, type FeedPost } from "@/lib/posts";
import { API_URL } from "@/lib/config";

interface UserStats {
  postsCount: number;
  likesReceived: number;
  commentsReceived: number;
}

async function getUserStats(username: string): Promise<UserStats | null> {
  try {
    const res = await fetch(`${API_URL}/api/users/${username}/stats`, { credentials: "include" });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}
import { User } from "@/lib/interfaces";
import type { UserSearchResult } from "@/lib/users/search";
import * as ws from "@/lib/ws/ws";

type Tab = "posts" | "followers" | "following" | "activity";
type FollowStatus = "none" | "pending" | "accepted";

/* ─────────────────────────────────────────────────────────── */
/*  Count-up animation hook                                    */
/* ─────────────────────────────────────────────────────────── */
function useCountUp(target: number, duration: number, animKey: number) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>();

  useEffect(() => {
    setValue(0);
    if (target === 0) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(Math.round(eased * target));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration, animKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return value;
}

/* ─────────────────────────────────────────────────────────── */
/*  Animated stat ring                                         */
/* ─────────────────────────────────────────────────────────── */
const RADIUS = 40;
const CIRC = 2 * Math.PI * RADIUS; // ≈ 251.3

function StatRing({
  value,
  maxValue,
  color,
  glowColor,
  label,
  icon: Icon,
  animKey,
  delay = 0,
}: {
  value: number;
  maxValue: number;
  color: string;
  glowColor: string;
  label: string;
  icon: React.ElementType;
  animKey: number;
  delay?: number;
}) {
  const displayed = useCountUp(value, 1600 + delay, animKey);
  const progress = maxValue > 0 ? Math.min(displayed / maxValue, 1) : 0;
  const offset = CIRC * (1 - progress);

  return (
    <div className="flex flex-col items-center gap-3 group">
      {/* Ring + icon + number */}
      <div className="relative w-36 h-36">

        {/* Slow-spinning outer dashed decoration */}
        <div
          className="absolute inset-[-6px] rounded-full"
          style={{ animation: `spin ${18 + delay / 100}s linear infinite` }}
        >
          <svg viewBox="0 0 108 108" className="w-full h-full opacity-20">
            <circle
              cx="54" cy="54" r="50"
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              strokeDasharray="4 8"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* Main ring SVG */}
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          {/* Track */}
          <circle cx="50" cy="50" r={RADIUS} fill="none"
            stroke="currentColor" strokeWidth="7"
            className="text-foreground/5"
          />
          {/* Progress arc */}
          <circle
            cx="50" cy="50" r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
            style={{
              transition: "stroke-dashoffset 1.6s cubic-bezier(0.4, 0, 0.2, 1)",
              filter: `drop-shadow(0 0 6px ${glowColor})`,
            }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
          <Icon
            className="w-5 h-5 transition-transform group-hover:scale-125"
            style={{ color, filter: `drop-shadow(0 0 4px ${glowColor})` }}
          />
          <span className="text-2xl font-black text-foreground tabular-nums leading-none">
            {displayed.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Label */}
      <div className="text-center">
        <p
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color }}
        >
          {label}
        </p>
      </div>
    </div>
  );
}

const PRIVACY_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  public:    { label: "PUBLIC",        icon: <Globe  className="w-3 h-3" /> },
  followers: { label: "FOLLOWERS",     icon: <Users  className="w-3 h-3" /> },
  selected:  { label: "CLOSE FRIENDS", icon: <Lock   className="w-3 h-3" /> },
};

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ─────────────────────────────────────────────────────────── */
/*  Profile Post Card — matches feed card style exactly        */
/* ─────────────────────────────────────────────────────────── */
function ProfilePostCard({ post, authorName, authorAvatarSrc }: {
  post: FeedPost;
  authorName: string;
  authorAvatarSrc: string | null;
}) {
  const [likes, setLikes] = useState(post.likes);
  const [isLiked, setIsLiked] = useState(post.is_liked);
  const [likeLoading, setLikeLoading] = useState(false);

  const privacy = PRIVACY_LABELS[post.privacy] ?? PRIVACY_LABELS.public;
  const isVideo = post.image_path
    ? /\.(mp4|webm|mov)$/i.test(post.image_path)
    : false;

  const handleLike = async () => {
    if (likeLoading) return;
    setLikeLoading(true);
    const prevLiked = isLiked; const prevCount = likes;
    setIsLiked(!prevLiked); setLikes(prevLiked ? prevCount - 1 : prevCount + 1);
    try {
      const res = await toggleLike(post.id);
      setIsLiked(res.is_liked); setLikes(res.likes);
    } catch { setIsLiked(prevLiked); setLikes(prevCount); }
    finally { setLikeLoading(false); }
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/posts/${post.author?.username ?? post.user_id}/${post.id}`;
    if (navigator.share) await navigator.share({ text: post.content, url });
    else await navigator.clipboard.writeText(url);
  };

  return (
    <div className="w-full flex flex-col bg-surface border border-border rounded-2xl overflow-hidden shrink-0">
      {/* Header */}
      <div className="p-5 flex items-center gap-3 border-b border-border">
        <div className="shrink-0">
          {authorAvatarSrc ? (
            <img src={authorAvatarSrc} alt={authorName}
              className="w-11 h-11 rounded-full object-cover" />
          ) : (
            <div className="w-11 h-11 rounded-full bg-foreground/10 flex items-center justify-center border border-border font-semibold text-foreground/60">
              {authorName[0]}
            </div>
          )}
        </div>
        <div>
          <p className="font-semibold text-foreground">{authorName}</p>
          <div className="flex items-center gap-1.5 text-[11px] text-foreground/40 font-semibold uppercase tracking-wider mt-0.5">
            <span>{timeAgo(post.created_at)}</span>
            <span>·</span>
            {privacy.icon}
            <span>{privacy.label}</span>
          </div>
        </div>
      </div>

      {/* Text content */}
      {post.content && (
        <div className="px-5 py-4">
          <p className="text-base text-foreground/85 leading-relaxed whitespace-pre-wrap break-words">
            {post.content}
          </p>
        </div>
      )}

      {/* Media */}
      {post.image_path && (
        isVideo ? (
          <div className="bg-foreground/5">
            <video
              src={`${API_URL}${post.image_path}`}
              controls
              className="w-full max-h-[420px]"
            />
          </div>
        ) : (
          <div className="bg-foreground/5">
            <img
              src={`${API_URL}${post.image_path}`}
              alt="post"
              className="w-full object-contain max-h-[420px]"
            />
          </div>
        )
      )}

      {/* Action bar */}
      <div className="px-5 py-4 flex items-center gap-5 border-t border-border">
        <button
          onClick={handleLike}
          disabled={likeLoading}
          className="flex items-center gap-2 text-muted hover:text-primary transition-colors group disabled:opacity-50"
        >
          <Heart className={`w-6 h-6 transition-all ${isLiked ? "fill-primary text-primary scale-110" : "group-hover:scale-110"}`} />
          <span className="text-sm font-bold">{likes > 0 ? likes : ""}</span>
        </button>

        <button className="flex items-center gap-2 text-muted hover:text-primary transition-colors group">
          <MessageSquare className="w-6 h-6 group-hover:scale-110 transition-transform" />
          <span className="text-sm font-bold">{post.comments_count > 0 ? post.comments_count : "0"}</span>
        </button>

        <button
          onClick={handleShare}
          className="ml-auto text-muted hover:text-primary transition-colors"
        >
          <Share2 className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/*  Person row inside followers / following list               */
/* ─────────────────────────────────────────────────────────── */
function PersonRow({
  person,
  currentUserId,
  onFollowChange,
}: {
  person: UserSearchResult;
  currentUserId?: number;
  onFollowChange: (username: string, prev: FollowStatus, next: FollowStatus) => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<FollowStatus>(person.followStatus ?? "none");
  const [busy, setBusy] = useState(false);

  const isSelf = currentUserId != null && person.userId === currentUserId;
  const avatarSrc = person.avatar ? `${API_URL}${person.avatar}` : null;
  const displayName =
    `${person.firstName} ${person.lastName}`.trim() || person.username;

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy || isSelf) return;
    const prev = status;

    if (status === "accepted" || status === "pending") {
      setStatus("none");
      setBusy(true);
      const res = await unfollowUser(person.username);
      if (res.success) {
        onFollowChange(person.username, prev, "none");
      } else {
        setStatus(prev);
      }
    } else {
      setStatus("accepted");
      setBusy(true);
      const res = await followUser(person.username);
      if (res.success) {
        const next = (res.status ?? "accepted") as FollowStatus;
        setStatus(next);
        onFollowChange(person.username, prev, next);
      } else {
        setStatus(prev);
      }
    }
    setBusy(false);
  };

  const label =
    status === "accepted" ? "Unfollow" : status === "pending" ? "Requested" : "Follow";

  const btnClass = isSelf
    ? "h-8 px-4 rounded-lg bg-surface border border-border text-muted text-xs font-bold cursor-default shrink-0"
    : status === "none"
    ? "h-8 px-4 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary hover:text-black transition-colors shrink-0 border border-primary/30"
    : "h-8 px-4 rounded-lg bg-surface border border-border text-foreground text-xs font-bold hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors shrink-0";

  return (
    <div
      className="flex items-center justify-between px-5 py-4 hover:bg-background/50 transition-colors cursor-pointer"
      onClick={() => router.push(`/profile/${person.username}`)}
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-11 h-11 rounded-full bg-primary/10 ring-2 ring-primary/20 overflow-hidden flex items-center justify-center shrink-0">
          {avatarSrc ? (
            <img src={avatarSrc} alt={displayName} className="w-full h-full object-cover" />
          ) : (
            <UserIcon className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-foreground text-sm font-bold truncate">{displayName}</p>
          <p className="text-muted text-xs truncate">@{person.username}</p>
        </div>
      </div>
      <button onClick={isSelf ? undefined : handleClick} disabled={busy || isSelf} className={btnClass}>
        {isSelf ? "You" : busy ? <Loader2 className="w-3 h-3 animate-spin" /> : label}
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────── */
/*  Main profile page                                          */
/* ─────────────────────────────────────────────────────────── */
export default function ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const usernameParam = params.username as string;

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [profileUser, setProfileUser] = useState<User | PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [headerFollowStatus, setHeaderFollowStatus] = useState<FollowStatus>("none");
  const [headerFollowBusy, setHeaderFollowBusy] = useState(false);
  const [togglingPrivacy, setTogglingPrivacy] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<Tab>("posts");

  // Posts tab state
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [postsOffset, setPostsOffset] = useState(0);
  const [postsHasMore, setPostsHasMore] = useState(true);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsInitialized, setPostsInitialized] = useState(false);
  const postsScrollRef = useRef<HTMLDivElement>(null);

  // Activity tab state
  const [stats, setStats] = useState<UserStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsAnimKey, setStatsAnimKey] = useState(0);

  // Followers / following lists
  const [followers, setFollowers] = useState<UserSearchResult[]>([]);
  const [following, setFollowing] = useState<UserSearchResult[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listSearch, setListSearch] = useState("");
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  const isOwnProfile =
    usernameParam === "me" ||
    (currentUser != null && usernameParam === currentUser.username);

  /* ── Load profile ── */
  useEffect(() => {
    async function load() {
      const me = await getCurrentUser();
      if (!me) { router.push("/login"); return; }
      setCurrentUser(me);

      if (usernameParam === "me" || usernameParam === me.username) {
        setProfileUser(me);
        setLoading(false);
      } else {
        const data = await fetchUserProfile(usernameParam);
        if (!data) {
          setNotFound(true);
        } else {
          setProfileUser(data);
          setHeaderFollowStatus((data.followStatus ?? "none") as FollowStatus);
          setFollowersCount(data.followersCount);
          setFollowingCount(data.followingCount);
        }
        setLoading(false);
      }
    }
    load();
  }, [usernameParam, router]);

  /* ── Load followers + following lists ── */
  useEffect(() => {
    if (!profileUser) return;
    const target = (profileUser as User).username ?? (profileUser as PublicProfile).username;

    async function loadLists() {
      setListLoading(true);
      const [frsRes, fngRes] = await Promise.all([
        getFollowers(target),
        getFollowing(target),
      ]);
      setFollowers(frsRes.followers ?? []);
      setFollowing(fngRes.following ?? []);
      if (isOwnProfile) {
        setFollowersCount(frsRes.count ?? 0);
        setFollowingCount(fngRes.count ?? 0);
      }
      setListLoading(false);
    }
    loadLists();
  }, [profileUser]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Load posts (first page) ── */
  useEffect(() => {
    if (!profileUser || postsInitialized) return;
    const target = (profileUser as User).username ?? (profileUser as PublicProfile).username;
    if (!target) return;

    async function loadPosts() {
      setPostsLoading(true);
      try {
        const res = await getUserPosts(target, 0, 10);
        setPosts(res.posts);
        setPostsOffset(res.posts.length);
        setPostsHasMore(res.has_more);
        setPostsInitialized(true);
      } catch {
        setPostsInitialized(true);
      } finally {
        setPostsLoading(false);
      }
    }
    loadPosts();
  }, [profileUser]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Load more posts on scroll ── */
  const loadMorePosts = async () => {
    if (postsLoading || !postsHasMore) return;
    const target = (profileUser as User)?.username ?? (profileUser as PublicProfile)?.username;
    if (!target) return;
    setPostsLoading(true);
    try {
      const res = await getUserPosts(target, postsOffset, 10);
      setPosts((prev) => [...prev, ...res.posts]);
      setPostsOffset((o) => o + res.posts.length);
      setPostsHasMore(res.has_more);
    } catch {
      // ignore
    } finally {
      setPostsLoading(false);
    }
  };

  /* ── Scroll-to-load for posts ── */
  useEffect(() => {
    const el = postsScrollRef.current;
    if (!el) return;
    const handler = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) {
        loadMorePosts();
      }
    };
    el.addEventListener("scroll", handler);
    return () => el.removeEventListener("scroll", handler);
  }); // no dep array — re-runs each render to capture fresh state

  /* ── Load stats when Activity tab opens ── */
  useEffect(() => {
    if (activeTab !== "activity" || !profileUser) return;
    // Re-trigger animation every time the tab is visited
    setStatsAnimKey((k) => k + 1);
    if (stats) return; // already loaded — just replay animation
    const username = (profileUser as User).username ?? (profileUser as PublicProfile).username;
    setStatsLoading(true);
    getUserStats(username).then((s) => {
      setStats(s);
      setStatsLoading(false);
    });
  }, [activeTab, profileUser]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Sync profile when settings are saved ── */
  useEffect(() => {
    if (!isOwnProfile) return;
    const handleUserUpdated = (e: Event) => {
      const updated = (e as CustomEvent).detail as User;
      if (!updated) return;
      setCurrentUser(updated);
      setProfileUser(updated);
    };
    window.addEventListener("userUpdated", handleUserUpdated);
    return () => window.removeEventListener("userUpdated", handleUserUpdated);
  }, [isOwnProfile]);

  /* ── Privacy toggle (own profile) ── */
  const handlePrivacyToggle = async () => {
    if (!currentUser || togglingPrivacy) return;
    const u = profileUser as User;
    const currentIsPublic = u.isPublic === true;
    const newIsPublic = !currentIsPublic;
    setTogglingPrivacy(true);
    setProfileUser((p) => p ? { ...p, isPublic: newIsPublic } : p);

    const result = await updateProfile({
      firstName: u.firstName,
      lastName: u.lastName,
      username: u.username,
      nickname: u.nickname || "",
      email: u.email,
      dateOfBirth: u.dateOfBirth ? u.dateOfBirth.split("T")[0] : "",
      aboutMe: u.aboutMe || "",
      isPublic: newIsPublic,
    });

    if (result.success && result.user) {
      const updated = { ...u, ...result.user, isPublic: newIsPublic };
      setProfileUser(updated);
      localStorage.setItem("currentUser", JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent("userUpdated", { detail: updated }));
    } else {
      setProfileUser((p) => p ? { ...p, isPublic: !newIsPublic } : p);
    }
    setTogglingPrivacy(false);
  };

  /* ── Follow / Unfollow from header button ── */
  const handleHeaderFollow = async () => {
    if (headerFollowBusy || !profileUser) return;
    const target = (profileUser as PublicProfile).username;
    const prev = headerFollowStatus;

    if (headerFollowStatus === "accepted" || headerFollowStatus === "pending") {
      setHeaderFollowStatus("none");
      setHeaderFollowBusy(true);
      const res = await unfollowUser(target);
      if (res.success) {
        const fresh = await fetchUserProfile(usernameParam);
        if (fresh) {
          setProfileUser(fresh);
          setHeaderFollowStatus((fresh.followStatus ?? "none") as FollowStatus);
          setFollowersCount(fresh.followersCount);
          setFollowingCount(fresh.followingCount);
        }
      } else {
        setHeaderFollowStatus(prev);
      }
    } else {
      setHeaderFollowStatus("accepted");
      setHeaderFollowBusy(true);
      const res = await followUser(target);
      if (res.success) {
        const next = (res.status ?? "accepted") as FollowStatus;
        setHeaderFollowStatus(next);
        const fresh = await fetchUserProfile(usernameParam);
        if (fresh) {
          setProfileUser(fresh);
          setFollowersCount(fresh.followersCount);
          setFollowingCount(fresh.followingCount);
          setHeaderFollowStatus((fresh.followStatus ?? next) as FollowStatus);
        }
      } else {
        setHeaderFollowStatus(prev);
      }
    }
    setHeaderFollowBusy(false);
  };

  /* ── Follow change from list rows ── */
  const handleFollowChange = (
    targetUsername: string,
    prev: FollowStatus,
    next: FollowStatus,
  ) => {
    const patch = (list: UserSearchResult[]): UserSearchResult[] =>
      list.map((u) =>
        u.username === targetUsername ? { ...u, followStatus: next } : u,
      );
    setFollowers(patch);
    setFollowing(patch);

    if (prev !== "accepted" && next === "accepted") {
      setFollowingCount((c) => c + 1);
    } else if (prev === "accepted" && next === "none") {
      setFollowingCount((c) => Math.max(0, c - 1));
    }
  };

  /* ── Real-time follow updates (own profile) ── */
  useEffect(() => {
    if (!isOwnProfile) return;

    const handleWsFollowUpdate = (data: any) => {
      if (data.type !== "follow_update") return;
      const d = data.data;

      if (d.status === "accepted") {
        setFollowers((prev) => {
          if (prev.some((u) => u.userId === d.followerId)) return prev;
          const newUser: UserSearchResult = {
            userId: d.followerId,
            username: d.followerUsername,
            firstName: d.followerFirstName,
            lastName: d.followerLastName,
            avatar: d.followerAvatar || "",
            nickname: "",
            aboutMe: "",
            isPublic: true,
            followStatus: "none",
            followsMe: true,
          };
          return [newUser, ...prev];
        });
        setFollowersCount((c) => c + 1);
      } else if (d.status === "none") {
        setFollowers((prev) => prev.filter((u) => u.userId !== d.followerId));
        setFollowersCount((c) => Math.max(0, c - 1));
      }
    };

    ws.on("follow_update", handleWsFollowUpdate);
    return () => { ws.off("follow_update", handleWsFollowUpdate); };
  }, [isOwnProfile]);

  /* ── Real-time privacy changes for other profiles ── */
  useEffect(() => {
    if (isOwnProfile || !profileUser) return;
    const targetId = (profileUser as PublicProfile).userId;

    const handlePrivacyChanged = async (data: any) => {
      if (data.type !== "privacy_changed") return;
      if (data.data.userId !== targetId) return;
      const fresh = await fetchUserProfile(usernameParam);
      if (!fresh) return;
      setProfileUser(fresh);
      setHeaderFollowStatus((fresh.followStatus ?? "none") as FollowStatus);
      setFollowersCount(fresh.followersCount);
      setFollowingCount(fresh.followingCount);
    };

    ws.on("privacy_changed", handlePrivacyChanged);
    return () => { ws.off("privacy_changed", handlePrivacyChanged); };
  }, [isOwnProfile, profileUser, usernameParam]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Helpers ── */
  const getField = <K extends keyof User & keyof PublicProfile>(key: K) =>
    profileUser ? (profileUser as any)[key] : undefined;

  const avatarSrc = getField("avatar") ? `${API_URL}${getField("avatar")}` : null;
  const displayName =
    [getField("firstName"), getField("lastName")].filter(Boolean).join(" ") ||
    getField("username") || "";
  const handle = getField("nickname")
    ? `@${getField("nickname")}`
    : `@${getField("username")}`;
  const isPublic = getField("isPublic") === true;

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric", month: "long", day: "numeric",
      });
    } catch { return dateStr; }
  };

  const memberSince = getField("createdAt")
    ? new Date(getField("createdAt") as string).toLocaleDateString("en-US", {
        month: "short", year: "numeric",
      })
    : null;

  const searchLower = listSearch.toLowerCase();
  const displayedList = (activeTab === "followers" ? followers : following).filter((u) => {
    const hay = `${u.firstName} ${u.lastName} ${u.username} ${u.nickname ?? ""}`.toLowerCase();
    return hay.includes(searchLower);
  });

  /* ── Loading / not found states ── */
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-foreground text-lg font-semibold">User not found</p>
          <p className="text-muted text-sm mt-1">
            This profile doesn&apos;t exist or is private.
          </p>
        </div>
      </div>
    );
  }

  /* ── Locked profile (private account, non-follower) ── */
  const isLocked = !isOwnProfile && (profileUser as PublicProfile)?.isLocked === true;

  if (isLocked) {
    const p = profileUser as PublicProfile;
    const lockedAvatarSrc = p.avatar ? `${API_URL}${p.avatar}` : null;
    const lockedName = p.nickname ? `@${p.nickname}` : `@${p.username}`;
    const lockedFollowLabel =
      headerFollowStatus === "accepted" ? "Unfollow" : headerFollowStatus === "pending" ? "Requested" : "Follow";

    return (
      <div className="flex-1 flex justify-center py-8 px-4 md:px-10">
        <div className="max-w-md w-full flex flex-col gap-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 self-start text-sm font-semibold text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className="bg-surface border border-border rounded-xl p-8 flex flex-col items-center text-center gap-5">
            <div className="h-24 w-24 rounded-full bg-background border-4 border-primary/20 overflow-hidden flex items-center justify-center shrink-0">
              {lockedAvatarSrc ? (
                <img src={lockedAvatarSrc} alt={p.username} className="h-full w-full object-cover" />
              ) : (
                <UserIcon className="w-10 h-10 text-muted-foreground/40" />
              )}
            </div>

            <div>
              <h1 className="text-foreground text-xl font-bold">{p.username}</h1>
              <p className="text-muted text-sm mt-0.5">{lockedName}</p>
              <p className="text-muted text-xs mt-2">{p.followersCount} Followers</p>
            </div>

            <div className="flex flex-col items-center gap-2 py-4 border-t border-border w-full">
              <Lock className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-foreground font-semibold text-sm">This account is private</p>
              <p className="text-muted text-xs max-w-xs">
                Follow this account to see their photos and other content.
              </p>
            </div>

            <button
              onClick={handleHeaderFollow}
              disabled={headerFollowBusy}
              className={`flex items-center justify-center gap-2 h-10 px-8 rounded-lg text-sm font-semibold transition-colors ${
                headerFollowStatus === "none"
                  ? "bg-primary text-black hover:bg-primary/90"
                  : "bg-surface border border-border text-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
              }`}
            >
              {headerFollowBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : lockedFollowLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const headerFollowLabel =
    headerFollowStatus === "accepted"
      ? "Unfollow"
      : headerFollowStatus === "pending"
      ? "Requested"
      : "Follow";

  /* ── Tab definitions ── */
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "posts",     label: `Posts`,                icon: <FileText  className="w-4 h-4" /> },
    { key: "followers", label: `Followers (${followersCount})`, icon: <Users    className="w-4 h-4" /> },
    { key: "following", label: `Following (${followingCount})`, icon: <Users    className="w-4 h-4" /> },
    ...(isOwnProfile ? [{ key: "activity" as Tab, label: "Activity", icon: <Activity className="w-4 h-4" /> }] : []),
  ];

  return (
    <div className="flex-1 flex justify-center py-8 px-4 md:px-10">
      <div className="max-w-5xl w-full flex flex-col gap-6">

        {/* ── Back button (other users only) ── */}
        {!isOwnProfile && (
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 self-start text-sm font-semibold text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        )}

        {/* ── Profile header ── */}
        <div className="bg-surface border border-border rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
            <div className="flex items-center gap-5">

              {/* Avatar */}
              <div className="h-36 w-36 rounded-full bg-background border-4 border-primary/20 shadow-2xl overflow-hidden shrink-0">
                {avatarSrc ? (
                  <img src={avatarSrc} alt={displayName} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full flex items-center justify-center bg-foreground/5">
                    <span className="text-4xl font-bold text-muted-foreground/30">
                      {(getField("firstName")?.[0] || getField("username")?.[0] || "?").toUpperCase()}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-foreground text-2xl md:text-3xl font-bold tracking-tight">
                    {displayName}
                  </h1>

                  {/* Privacy badge */}
                  {isOwnProfile ? (
                    <button
                      onClick={handlePrivacyToggle}
                      disabled={togglingPrivacy}
                      title={`Switch to ${isPublic ? "Private" : "Public"}`}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
                        isPublic
                          ? "bg-primary/10 text-primary hover:bg-primary/20"
                          : "bg-zinc-500/10 text-muted hover:bg-zinc-500/20"
                      }`}
                    >
                      {togglingPrivacy ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : isPublic ? (
                        <Globe className="w-3 h-3" />
                      ) : (
                        <Lock className="w-3 h-3" />
                      )}
                      {isPublic ? "Public" : "Private"}
                    </button>
                  ) : (
                    <span
                      className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
                        isPublic ? "bg-primary/10 text-primary" : "bg-zinc-500/10 text-muted"
                      }`}
                    >
                      {isPublic ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                      {isPublic ? "Public" : "Private"}
                    </span>
                  )}
                </div>

                <p className="text-muted text-base">{handle}</p>

                <div className="flex gap-4 mt-1">
                  <button
                    onClick={() => setActiveTab("followers")}
                    className="text-sm font-semibold text-foreground hover:text-primary transition-colors"
                  >
                    {followersCount}{" "}
                    <span className="font-normal text-muted">Followers</span>
                  </button>
                  <button
                    onClick={() => setActiveTab("following")}
                    className="text-sm font-semibold text-foreground hover:text-primary transition-colors"
                  >
                    {followingCount}{" "}
                    <span className="font-normal text-muted">Following</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            {isOwnProfile ? (
              <button
                onClick={() => router.push("/settings")}
                className="flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-surface border border-border text-foreground text-sm font-semibold hover:bg-background transition-colors"
              >
                <Settings className="w-4 h-4" />
                Edit Profile
              </button>
            ) : (
              <button
                onClick={handleHeaderFollow}
                disabled={headerFollowBusy}
                className={`flex items-center justify-center gap-2 h-10 px-5 rounded-lg text-sm font-semibold transition-colors ${
                  headerFollowStatus === "none"
                    ? "bg-primary text-black hover:bg-primary/90"
                    : "bg-surface border border-border text-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                }`}
              >
                {headerFollowBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  headerFollowLabel
                )}
              </button>
            )}
          </div>
        </div>

        {/* ── Content grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">

          {/* ── Left sidebar ── */}
          <aside className="flex flex-col gap-4">
            {/* About */}
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-border">
                <h3 className="text-foreground font-bold text-base">About</h3>
              </div>
              <div className="p-5 flex flex-col gap-5">
                {getField("aboutMe") && (
                  <div className="flex flex-col gap-1">
                    <p className="text-muted text-xs font-bold uppercase tracking-wider">Bio</p>
                    <p className="text-foreground text-sm leading-relaxed">{getField("aboutMe")}</p>
                  </div>
                )}
                {isOwnProfile && (profileUser as User)?.dateOfBirth && (
                  <div className="flex flex-col gap-1">
                    <p className="text-muted text-xs font-bold uppercase tracking-wider">Birthday</p>
                    <div className="flex items-center gap-2 text-foreground">
                      <Cake className="w-4 h-4 text-primary shrink-0" />
                      <p className="text-sm">{formatDate((profileUser as User).dateOfBirth)}</p>
                    </div>
                  </div>
                )}
                {isOwnProfile && (profileUser as User)?.email && (
                  <div className="flex flex-col gap-1">
                    <p className="text-muted text-xs font-bold uppercase tracking-wider">Email</p>
                    <div className="flex items-center gap-2 text-foreground">
                      <Mail className="w-4 h-4 text-primary shrink-0" />
                      <p className="text-sm break-all">{(profileUser as User).email}</p>
                    </div>
                  </div>
                )}
                {!getField("aboutMe") && !isOwnProfile && (
                  <p className="text-muted text-sm">Nothing shared yet.</p>
                )}
                {!getField("aboutMe") && isOwnProfile &&
                  !(profileUser as User)?.dateOfBirth && (
                    <p className="text-muted text-sm">No details added yet.</p>
                  )}
              </div>
            </div>

            {/* Member since */}
            {memberSince && (
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-5">
                <p className="text-primary text-xs font-bold uppercase tracking-wider mb-3">Member</p>
                <div className="flex items-center gap-3">
                  <ShieldCheck className="w-8 h-8 text-primary shrink-0" />
                  <div>
                    <p className="text-foreground text-sm font-bold">Verified Account</p>
                    <p className="text-muted text-xs">Since {memberSince}</p>
                  </div>
                </div>
              </div>
            )}
          </aside>

          {/* ── Right panel — tabbed content ── */}
          <div className="bg-surface border border-border rounded-xl overflow-hidden flex flex-col h-[620px]">

            {/* Tab bar */}
            <div className="flex border-b border-border px-2 shrink-0 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-2 px-4 border-b-[3px] pb-[13px] pt-4 text-sm font-bold leading-normal whitespace-nowrap transition-colors ${
                    activeTab === tab.key
                      ? "border-primary text-primary"
                      : "border-transparent text-muted hover:text-foreground"
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── Posts tab ── */}
            {activeTab === "posts" && (
              <div
                ref={postsScrollRef}
                className="flex-1 overflow-y-auto p-4 flex flex-col gap-4"
              >
                {postsLoading && posts.length === 0 ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : posts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                    <FileText className="w-10 h-10 text-muted/40" />
                    <p className="text-foreground font-semibold text-sm">No posts yet</p>
                    <p className="text-muted text-xs max-w-xs">
                      {isOwnProfile
                        ? "Share your first post to see it here."
                        : "This user hasn't posted anything yet."}
                    </p>
                  </div>
                ) : (
                  <>
                    {posts.map((post) => (
                      <ProfilePostCard
                        key={post.id}
                        post={post}
                        authorName={displayName}
                        authorAvatarSrc={avatarSrc}
                      />
                    ))}
                    {postsLoading && (
                      <div className="flex justify-center py-4">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      </div>
                    )}
                    {!postsHasMore && posts.length > 0 && (
                      <p className="text-center text-muted text-xs py-4">
                        All posts loaded
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── Followers / Following tab ── */}
            {(activeTab === "followers" || activeTab === "following") && (
              <>
                {/* Search bar */}
                <div className="px-4 py-3 border-b border-border shrink-0">
                  <div className={`flex items-center gap-2.5 bg-background border rounded-xl px-3.5 h-11 transition-colors ${listSearch ? "border-primary/50 shadow-[0_0_0_3px_rgba(0,209,178,0.08)]" : "border-border hover:border-border/80 focus-within:border-primary/50 focus-within:shadow-[0_0_0_3px_rgba(0,209,178,0.08)]"}`}>
                    <Search className={`w-4 h-4 shrink-0 transition-colors ${listSearch ? "text-primary" : "text-muted"}`} />
                    <input
                      value={listSearch}
                      onChange={(e) => setListSearch(e.target.value)}
                      placeholder={`Search ${activeTab}…`}
                      className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted/60 outline-none"
                    />
                    {listSearch && (
                      <button
                        onClick={() => setListSearch("")}
                        className="shrink-0 w-5 h-5 rounded-full bg-foreground/10 hover:bg-foreground/20 flex items-center justify-center transition-colors"
                      >
                        <svg viewBox="0 0 12 12" className="w-2.5 h-2.5 text-muted fill-current">
                          <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
                        </svg>
                      </button>
                    )}
                  </div>
                  {listSearch && (
                    <p className="text-xs text-muted mt-2 px-1">
                      {displayedList.length > 0
                        ? `${displayedList.length} result${displayedList.length !== 1 ? "s" : ""} for "${listSearch}"`
                        : `No results for "${listSearch}"`}
                    </p>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-border">
                  {listLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    </div>
                  ) : displayedList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3 px-6 text-center">
                      {listSearch ? (
                        <>
                          <div className="w-14 h-14 rounded-2xl bg-foreground/5 flex items-center justify-center">
                            <Search className="w-6 h-6 text-muted/40" />
                          </div>
                          <div>
                            <p className="text-foreground font-semibold text-sm">
                              No user named &ldquo;{listSearch}&rdquo;
                            </p>
                            <p className="text-muted text-xs mt-1">
                              Try a different name or username.
                            </p>
                          </div>
                          <button
                            onClick={() => setListSearch("")}
                            className="text-xs text-primary hover:underline font-semibold mt-1"
                          >
                            Clear search
                          </button>
                        </>
                      ) : (
                        <>
                          <Users className="w-10 h-10 text-muted/40" />
                          <p className="text-foreground font-semibold text-sm">
                            {activeTab === "followers" ? "No followers yet" : "Not following anyone yet"}
                          </p>
                          <p className="text-muted text-xs max-w-xs">
                            {activeTab === "followers"
                              ? "When people follow this account they'll appear here."
                              : "Accounts this person follows will appear here."}
                          </p>
                        </>
                      )}
                    </div>
                  ) : (
                    displayedList.map((person) => (
                      <PersonRow
                        key={person.userId}
                        person={person}
                        currentUserId={currentUser?.userId}
                        onFollowChange={handleFollowChange}
                      />
                    ))
                  )}
                </div>
              </>
            )}

            {/* ── Activity tab ── */}
            {activeTab === "activity" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {statsLoading && !stats ? (
                  <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : stats ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6 py-6">

                    {/* Header */}
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-primary animate-pulse" />
                        <p className="text-foreground font-black text-sm uppercase tracking-widest">
                          Activity Overview
                        </p>
                        <Zap className="w-4 h-4 text-primary animate-pulse" />
                      </div>
                      <p className="text-muted text-xs">
                        {displayName}&apos;s stats at a glance
                      </p>
                    </div>

                    {/* Rings row */}
                    <div className="flex items-center justify-around w-full gap-4">
                      <StatRing
                        value={stats.postsCount}
                        maxValue={Math.max(stats.postsCount, stats.likesReceived, stats.commentsReceived, 1)}
                        color="#00d1b2"
                        glowColor="rgba(0,209,178,0.5)"
                        label="Posts"
                        icon={FileText}
                        animKey={statsAnimKey}
                        delay={0}
                      />
                      <StatRing
                        value={stats.likesReceived}
                        maxValue={Math.max(stats.postsCount, stats.likesReceived, stats.commentsReceived, 1)}
                        color="#f43f5e"
                        glowColor="rgba(244,63,94,0.5)"
                        label="Likes"
                        icon={Heart}
                        animKey={statsAnimKey}
                        delay={200}
                      />
                      <StatRing
                        value={stats.commentsReceived}
                        maxValue={Math.max(stats.postsCount, stats.likesReceived, stats.commentsReceived, 1)}
                        color="#60a5fa"
                        glowColor="rgba(96,165,250,0.5)"
                        label="Comments"
                        icon={MessageSquare}
                        animKey={statsAnimKey}
                        delay={400}
                      />
                    </div>

                    {/* Total engagement pill */}
                    <div className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-foreground/5 border border-border">
                      <Activity className="w-3.5 h-3.5 text-primary" />
                      <span className="text-xs text-muted font-semibold">
                        Total engagement —{" "}
                        <span className="text-foreground font-black">
                          {(stats.likesReceived + stats.commentsReceived).toLocaleString()}
                        </span>{" "}
                        interactions
                      </span>
                    </div>

                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-muted text-sm">Could not load stats.</p>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
