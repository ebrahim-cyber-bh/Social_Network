"use client";

import { useEffect, useRef, useState } from "react";
import {
  Heart,
  MessageCircle,
  Share2,
  Trash2,
  Pencil,
  Globe,
  Users,
  Lock,
  X,
  Check,
  MoreHorizontal,
} from "lucide-react";
import { API_URL } from "@/lib/config";
import {
  toggleLike,
  deletePost,
  updatePost,
  getComments,
  addComment,
  type FeedPost,
  type PostComment,
} from "@/lib/posts";

interface Props {
  post: FeedPost;
  currentUserId: number;
  onDeleted: (id: number) => void;
  onUpdated: (id: number, content: string, privacy: string) => void;
}

const PRIVACY_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  public: { label: "Public", icon: <Globe className="w-3 h-3" /> },
  followers: { label: "Private", icon: <Users className="w-3 h-3" /> },
  selected: { label: "Close Friends", icon: <Lock className="w-3 h-3" /> },
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

export default function FeedPostCard({ post, currentUserId, onDeleted, onUpdated }: Props) {
  const isOwner = post.user_id === currentUserId;

  const [likes, setLikes] = useState(post.likes);
  const [isLiked, setIsLiked] = useState(post.is_liked);
  const [likeLoading, setLikeLoading] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [editPrivacy, setEditPrivacy] = useState<"public" | "followers" | "selected">(post.privacy);
  const [editLoading, setEditLoading] = useState(false);

  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentsCount, setCommentsCount] = useState(post.comments_count);
  const [newComment, setNewComment] = useState("");
  const [commentLoading, setCommentLoading] = useState(false);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLike = async () => {
    if (likeLoading) return;
    setLikeLoading(true);
    const prevLiked = isLiked;
    const prevCount = likes;
    setIsLiked(!prevLiked);
    setLikes(prevLiked ? prevCount - 1 : prevCount + 1);
    try {
      const res = await toggleLike(post.id);
      setIsLiked(res.liked);
      setLikes(res.likes);
    } catch {
      setIsLiked(prevLiked);
      setLikes(prevCount);
    } finally {
      setLikeLoading(false);
    }
  };

  const handleDelete = async () => {
    setMenuOpen(false);
    if (!confirm("Delete this post?")) return;
    try {
      await deletePost(post.id);
      onDeleted(post.id);
    } catch {}
  };

  const handleEditSave = async () => {
    if (!editContent.trim()) return;
    setEditLoading(true);
    try {
      await updatePost(post.id, editContent.trim(), editPrivacy);
      onUpdated(post.id, editContent.trim(), editPrivacy);
      setEditing(false);
    } catch {
    } finally {
      setEditLoading(false);
    }
  };

  const handleToggleComments = async () => {
    if (!showComments && !commentsLoaded) {
      try {
        const data = await getComments(post.id);
        setComments(data);
        setCommentsLoaded(true);
      } catch {}
    }
    setShowComments((prev) => !prev);
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || commentLoading) return;
    setCommentLoading(true);
    try {
      await addComment(post.id, newComment.trim());
      const data = await getComments(post.id);
      setComments(data);
      setCommentsCount((prev) => prev + 1);
      setNewComment("");
    } catch {
    } finally {
      setCommentLoading(false);
    }
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ text: post.content, url });
    } else {
      await navigator.clipboard.writeText(url);
    }
  };

  const author = post.author;
  const authorName = author ? `${author.firstName} ${author.lastName}` : "Unknown";
  const privacy = PRIVACY_LABELS[post.privacy] ?? PRIVACY_LABELS.public;

  return (
    <div className="bg-background border border-border rounded-xl overflow-hidden shadow-sm">
      {/* ── Header ── */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="shrink-0">
            {author?.avatar ? (
              <img
                src={`${API_URL}${author.avatar}`}
                alt={authorName}
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-foreground/10 flex items-center justify-center border border-border font-semibold text-sm text-foreground/60">
                {authorName[0]}
              </div>
            )}
          </div>
          <div>
            <p className="font-semibold text-sm text-foreground">{authorName}</p>
            <div className="flex items-center gap-1 text-[10px] text-foreground/40 font-semibold uppercase tracking-wider mt-0.5">
              <span>{timeAgo(post.created_at)}</span>
              <span>·</span>
              {privacy.icon}
              <span>{privacy.label}</span>
            </div>
          </div>
        </div>

        {/* Three-dot menu (owner only) */}
        {isOwner && !editing && (
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="p-1.5 rounded-full hover:bg-foreground/5 text-foreground/40 hover:text-foreground transition-colors"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-8 w-36 bg-background border border-border rounded-xl shadow-xl z-20 overflow-hidden">
                <button
                  onClick={() => { setEditing(true); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-foreground/70 hover:bg-foreground/5 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
                <button
                  onClick={handleDelete}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-500/5 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Content / Edit mode ── */}
      <div className="px-4 pb-4">
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              maxLength={500}
              rows={3}
              className="w-full resize-none bg-foreground/5 rounded-lg px-3 py-2 text-sm text-foreground border border-border focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <select
                value={editPrivacy}
                onChange={(e) => setEditPrivacy(e.target.value as "public" | "followers" | "selected")}
                className="text-xs bg-foreground/5 border border-border rounded-lg px-2 py-1.5 text-foreground focus:outline-none"
              >
                <option value="public">Public</option>
                <option value="followers">Private</option>
                <option value="selected">Close Friends</option>
              </select>
              <div className="flex-1" />
              <button
                onClick={() => setEditing(false)}
                className="p-1.5 rounded-lg hover:bg-foreground/5 text-foreground/40"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                onClick={handleEditSave}
                disabled={editLoading || !editContent.trim()}
                className="p-1.5 rounded-lg hover:bg-green-500/10 text-green-600 disabled:opacity-40"
              >
                <Check className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
            {post.content}
          </p>
        )}
      </div>

      {/* ── Post image ── */}
      {post.image_path && !editing && (
        <div className="aspect-video bg-foreground/5">
          <img
            src={`${API_URL}${post.image_path}`}
            alt="post"
            loading="lazy"
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* ── Action bar ── */}
      <div className="p-3 border-t border-border flex items-center gap-4">
        <button
          onClick={handleLike}
          disabled={likeLoading}
          className={`flex items-center gap-1.5 text-sm transition-colors ${
            isLiked ? "text-red-500" : "text-foreground/50 hover:text-red-500"
          }`}
        >
          <Heart className={`w-5 h-5 ${isLiked ? "fill-current" : ""}`} />
          <span>{likes}</span>
        </button>

        <button
          onClick={handleToggleComments}
          className="flex items-center gap-1.5 text-sm text-foreground/50 hover:text-primary transition-colors"
        >
          <MessageCircle className="w-5 h-5" />
          <span>{commentsCount}</span>
        </button>

        <button
          onClick={handleShare}
          className="flex items-center gap-1.5 text-sm text-foreground/50 hover:text-primary transition-colors ml-auto"
        >
          <Share2 className="w-5 h-5" />
        </button>
      </div>

      {/* ── Comments ── */}
      {showComments && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {comments.length === 0 && (
            <p className="text-xs text-foreground/30 text-center py-2">
              No comments yet
            </p>
          )}

          {comments.map((c) => {
            const cAuthor = c.author;
            const cName = cAuthor
              ? `${cAuthor.firstName} ${cAuthor.lastName}`
              : "User";
            return (
              <div key={c.id} className="flex gap-2">
                <div className="shrink-0">
                  {cAuthor?.avatar ? (
                    <img
                      src={`${API_URL}${cAuthor.avatar}`}
                      alt={cName}
                      className="w-7 h-7 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-foreground/10 flex items-center justify-center text-xs font-semibold text-foreground/60 border border-border">
                      {cName[0]}
                    </div>
                  )}
                </div>
                <div className="flex-1 bg-foreground/5 rounded-xl px-3 py-2">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs font-semibold text-foreground">
                      {cName}
                    </span>
                    <span className="text-[10px] text-foreground/30">
                      · {timeAgo(c.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-foreground/80">{c.content}</p>
                </div>
              </div>
            );
          })}

          {/* Add comment */}
          <form onSubmit={handleAddComment} className="flex gap-2 pt-1">
            <input
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Write a comment..."
              maxLength={300}
              className="flex-1 bg-foreground/5 rounded-full px-4 py-2 text-sm text-foreground placeholder:text-foreground/30 focus:outline-none border border-transparent focus:border-border"
            />
            <button
              type="submit"
              disabled={!newComment.trim() || commentLoading}
              className="px-4 py-2 rounded-full bg-primary text-white text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              Post
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
