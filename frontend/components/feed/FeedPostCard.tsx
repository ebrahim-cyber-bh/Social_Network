"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  Heart, MessageSquare, Share2, Trash2, Pencil,
  Globe, Users, Lock, X, MoreHorizontal, ChevronDown, AlertTriangle,
} from "lucide-react";
import { API_URL } from "@/lib/config";
import {
  toggleLike, deletePost, updatePost,
  type FeedPost,
} from "@/lib/posts";

interface Props {
  post: FeedPost;
  currentUserId: number;
  onDeleted: (id: number) => void;
  onUpdated: (id: number, content: string, privacy: string) => void;
}

const PRIVACY_OPTIONS = [
  { value: "public",    label: "Public",        icon: Globe  },
  { value: "followers", label: "Private",       icon: Users  },
  { value: "selected",  label: "Close Friends", icon: Lock   },
];

const PRIVACY_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  public:    { label: "Public",        icon: <Globe  className="w-3 h-3" /> },
  followers: { label: "Private",       icon: <Users  className="w-3 h-3" /> },
  selected:  { label: "Close Friends", icon: <Lock   className="w-3 h-3" /> },
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
  const router = useRouter();

  const [likes, setLikes] = useState(post.likes);
  const [isLiked, setIsLiked] = useState(post.is_liked);
  const [likeLoading, setLikeLoading] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(post.content);
  const [editPrivacy, setEditPrivacy] = useState<"public" | "followers" | "selected">(post.privacy);
  const [editPrivacyOpen, setEditPrivacyOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  // For portal-based dropdown positioning
  const privacyBtnRef = useRef<HTMLButtonElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  const [commentsCount] = useState(post.comments_count);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close privacy portal dropdown on outside click
  useEffect(() => {
    if (!editPrivacyOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (privacyBtnRef.current && !privacyBtnRef.current.contains(target)) {
        setEditPrivacyOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editPrivacyOpen]);

  const openPrivacyDropdown = () => {
    if (privacyBtnRef.current) {
      const r = privacyBtnRef.current.getBoundingClientRect();
      setDropdownPos({ top: r.bottom + 6, left: r.left, width: r.width });
    }
    setEditPrivacyOpen((o) => !o);
  };

  const handleLike = async () => {
    if (likeLoading) return;
    setLikeLoading(true);
    const prevLiked = isLiked;
    const prevCount = likes;
    setIsLiked(!prevLiked);
    setLikes(prevLiked ? prevCount - 1 : prevCount + 1);
    try {
      const res = await toggleLike(post.id);
      setIsLiked(res.is_liked);
      setLikes(res.likes);
    } catch {
      setIsLiked(prevLiked);
      setLikes(prevCount);
    } finally {
      setLikeLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      await deletePost(post.id);
      onDeleted(post.id);
    } catch {
      setDeleting(false);
      setShowDeleteModal(false);
    }
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

  const handleCancelEdit = () => {
    setEditContent(post.content);
    setEditPrivacy(post.privacy);
    setEditing(false);
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ text: post.content, url });
    else await navigator.clipboard.writeText(url);
  };

  const author = post.author;
  const authorName = author ? `${author.firstName} ${author.lastName}` : "Unknown";
  const privacy = PRIVACY_LABELS[post.privacy] ?? PRIVACY_LABELS.public;
  const currentEditPrivacy = PRIVACY_OPTIONS.find((o) => o.value === editPrivacy)!;
  const EditPrivacyIcon = currentEditPrivacy.icon;

  return (
    <>
      <div
        className="bg-surface border border-border rounded-xl overflow-hidden cursor-pointer"
        onClick={() => router.push(`/posts/${post.author?.username ?? post.user_id}/${post.id}`)}
      >

        {/* ── Header ── */}
        <div className="p-4 flex items-center justify-between" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-3">
            <div className="shrink-0">
              {author?.avatar ? (
                <img src={`${API_URL}${author.avatar}`} alt={authorName}
                  className="w-10 h-10 rounded-full object-cover" />
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

          {isOwner && !editing && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((o) => !o)}
                className="p-1.5 rounded-full hover:bg-foreground/5 text-foreground/40 hover:text-foreground transition-colors"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-9 w-40 bg-background border border-border rounded-xl shadow-2xl z-20 overflow-hidden py-1">
                  <button
                    onClick={() => { setEditing(true); setMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground/70 hover:bg-foreground/5 hover:text-foreground transition-colors"
                  >
                    <Pencil className="w-4 h-4" /> Edit post
                  </button>
                  <div className="mx-3 border-t border-border" />
                  <button
                    onClick={() => { setShowDeleteModal(true); setMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-500/5 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> Delete post
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Edit mode ── */}
        {editing ? (
          <div className="px-4 pb-4 space-y-3">
            <div className="relative">
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                maxLength={500}
                rows={4}
                autoFocus
                className="w-full resize-none bg-foreground/5 border border-border rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors"
              />
              <span className="absolute bottom-2.5 right-3 text-[10px] text-foreground/30">
                {editContent.length}/500
              </span>
            </div>

            {/* Privacy button — dropdown rendered via portal to escape overflow:hidden */}
            <button
              ref={privacyBtnRef}
              type="button"
              onClick={openPrivacyDropdown}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-foreground/5 border border-border text-sm text-foreground/70 hover:bg-foreground/10 transition-colors"
            >
              <EditPrivacyIcon className="w-4 h-4" />
              <span>{currentEditPrivacy.label}</span>
              <ChevronDown className="w-3.5 h-3.5 ml-1 text-foreground/40" />
            </button>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={handleCancelEdit}
                className="px-4 py-2 rounded-lg text-sm text-foreground/60 hover:bg-foreground/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={editLoading || !editContent.trim()}
                className="px-5 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {editLoading ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        ) : (
          <div className="px-4 pb-4 min-h-[56px] w-full">
            {post.content && (
              <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
                {post.content}
              </p>
            )}
          </div>
        )}

        {/* ── Post image ── */}
        {post.image_path && !editing && (
          <div
            className="bg-foreground/5 cursor-zoom-in"
            onClick={(e) => { e.stopPropagation(); setLightbox(true); }}
          >
            <img src={`${API_URL}${post.image_path}`} alt="post" loading="lazy"
              className="w-full object-contain max-h-96" />
          </div>
        )}

        {/* ── Action bar ── */}
        {!editing && (
          <div className="p-3 border-t border-border flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={handleLike}
              disabled={likeLoading}
              className="flex items-center gap-2 text-muted hover:text-primary transition-colors group disabled:opacity-50"
            >
              <Heart className={`w-5 h-5 transition-all ${isLiked ? "fill-primary text-primary" : "group-hover:scale-110"}`} />
              <span className="text-xs font-bold">{likes > 0 ? likes : ""}</span>
            </button>
            <button
              onClick={() => { sessionStorage.setItem("focusComment", "1"); router.push(`/posts/${post.author?.username ?? post.user_id}/${post.id}`); }}
              className="flex items-center gap-2 text-muted hover:text-primary transition-colors group"
            >
              <MessageSquare className="w-5 h-5 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-bold">{commentsCount > 0 ? commentsCount : "0"}</span>
            </button>
            <button
              onClick={handleShare}
              className="flex items-center gap-1.5 text-sm text-foreground/50 hover:text-primary transition-colors ml-auto"
            >
              <Share2 className="w-5 h-5" />
            </button>
          </div>
        )}

      </div>

      {/* ── Privacy dropdown portal (escapes overflow:hidden) ── */}
      {editPrivacyOpen && typeof window !== "undefined" && createPortal(
        <div
          style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, minWidth: 176, zIndex: 9999 }}
          className="bg-background border border-border rounded-xl shadow-2xl overflow-hidden py-1"
        >
          {PRIVACY_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => { setEditPrivacy(opt.value as typeof editPrivacy); setEditPrivacyOpen(false); }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-foreground/5 ${
                  editPrivacy === opt.value ? "text-primary font-medium" : "text-foreground/70"
                }`}
              >
                <Icon className="w-4 h-4" />
                {opt.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}

      {/* ── Delete confirmation modal ── */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => !deleting && setShowDeleteModal(false)}
          />
          <div className="relative w-full max-w-sm bg-background border border-border rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-foreground">Delete post</p>
                  <p className="text-xs text-foreground/40 mt-0.5">This action cannot be undone</p>
                </div>
              </div>
              <button
                onClick={() => !deleting && setShowDeleteModal(false)}
                className="p-1.5 rounded-full hover:bg-foreground/5 text-foreground/40 hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {post.content && (
              <div className="mx-5 mb-5 p-3 bg-foreground/5 border border-border rounded-xl">
                <p className="text-sm text-foreground/70 line-clamp-3">{post.content}</p>
              </div>
            )}
            <div className="flex gap-2 px-5 pb-5">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-foreground/70 hover:bg-foreground/5 disabled:opacity-40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
              >
                {deleting ? "Deleting..." : <><Trash2 className="w-4 h-4" /> Delete</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Image lightbox ── */}
      {lightbox && post.image_path && typeof window !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm cursor-zoom-out"
          onClick={() => setLightbox(false)}
        >
          <img
            src={`${API_URL}${post.image_path}`}
            alt="full"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}
    </>
  );
}
