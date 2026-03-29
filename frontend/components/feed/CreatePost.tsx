"use client";

import { useRef, useState, useEffect } from "react";
import { Send, Image as ImageIcon, X, Globe, Users, Lock, ChevronDown, Video } from "lucide-react";
import { createPost } from "@/lib/posts";
import type { User } from "@/lib/interfaces";

interface Props {
  user: User;
  onPostCreated: () => void;
}

const PRIVACY_OPTIONS = [
  { value: "public",    label: "Public",        icon: Globe  },
  { value: "followers", label: "Private",       icon: Users  },
  { value: "selected",  label: "Close Friends", icon: Lock   },
];

const IMAGE_MAX = 10 * 1024 * 1024; // 10 MB
const VIDEO_MAX = 25 * 1024 * 1024; // 25 MB
const MAX_ASPECT_RATIO = 3.0; // max ratio either way (e.g. 3:1 or 1:3)

function isVideoFile(file: File) {
  return file.type.startsWith("video/");
}

function checkAspectRatio(w: number, h: number): boolean {
  if (w === 0 || h === 0) return true;
  const r = w / h;
  return r <= MAX_ASPECT_RATIO && r >= 1 / MAX_ASPECT_RATIO;
}

function getImageDimensions(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({ w: 1, h: 1 }); };
    img.src = url;
  });
}

function getVideoDimensions(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve({ w: video.videoWidth, h: video.videoHeight }); };
    video.onerror = () => { URL.revokeObjectURL(url); resolve({ w: 1, h: 1 }); };
    video.src = url;
  });
}

export default function CreatePost({ user, onPostCreated }: Props) {
  const [content, setContent]       = useState("");
  const [privacy, setPrivacy]       = useState("public");
  const [media, setMedia]           = useState<File | null>(null);
  const [preview, setPreview]       = useState<string | null>(null);
  const [mediaIsVideo, setMediaIsVideo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const fileRef     = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [content]);

  const currentPrivacy = PRIVACY_OPTIONS.find((o) => o.value === privacy)!;
  const PrivacyIcon = currentPrivacy.icon;

  const handleMediaChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const video = isVideoFile(file);
    const limit = video ? VIDEO_MAX : IMAGE_MAX;
    if (file.size > limit) {
      setError(video ? "Video must be at most 25 MB" : "Photo/GIF must be at most 10 MB");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    const { w, h } = video ? await getVideoDimensions(file) : await getImageDimensions(file);
    if (!checkAspectRatio(w, h)) {
      setError("Unsupported aspect ratio — please use a standard ratio (e.g. 16:9, 9:16, 4:3, 1:1). Max ratio is 3:1.");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setError(null);
    setMedia(file);
    setMediaIsVideo(video);
    setPreview(URL.createObjectURL(file));
  };

  const removeMedia = () => {
    setMedia(null);
    setPreview(null);
    setMediaIsVideo(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleSubmit = async () => {
    if (!media || content.length > 500 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await createPost(content.trim(), privacy, media);
      setContent("");
      removeMedia();
      onPostCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create post");
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-4">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={`What's on your mind, ${user.firstName}? (optional)`}
        rows={3}
        disabled={submitting}
        className={`w-full bg-background text-foreground border rounded-lg p-3 text-sm resize-none overflow-hidden outline-none placeholder:text-muted transition-colors ${
          content.length > 500
            ? "border-red-500 focus:ring-1 focus:ring-red-500"
            : "border-border focus:ring-1 focus:ring-primary"
        }`}
      />

      {/* Char counter */}
      {content.length > 0 && (
        <div className="flex items-center justify-between mt-1 px-1">
          {content.length > 500 ? (
            <p className="text-xs text-red-500">Content must be at most 500 characters</p>
          ) : content.length >= 400 ? (
            <p className="text-xs text-foreground/40">{500 - content.length} characters remaining</p>
          ) : (
            <span />
          )}
          <p className={`text-xs ml-auto ${content.length > 500 ? "text-red-500" : "text-foreground/30"}`}>
            {content.length}/500
          </p>
        </div>
      )}

      {/* Media preview */}
      {preview && (
        <div className="relative w-fit mt-2">
          {mediaIsVideo ? (
            <video
              src={preview}
              controls
              className="max-h-40 rounded-lg border border-border"
            />
          ) : (
            <img
              src={preview}
              alt="preview"
              className="max-h-40 rounded-lg object-cover border border-border"
            />
          )}
          <button
            type="button"
            onClick={removeMedia}
            className="absolute top-1 right-1 bg-background/90 rounded-full p-0.5 border border-border hover:bg-background"
          >
            <X className="w-3 h-3 text-foreground" />
          </button>
        </div>
      )}

      {/* Media required hint */}
      {!media && (
        <p className="text-xs text-foreground/40 mt-2">
          A photo, GIF, or video is required · Max 10 MB for images/GIFs, 25 MB for videos
        </p>
      )}

      {error && <p className="text-xs text-red-500 mt-2">{error}</p>}

      {/* Bottom row */}
      <div className="flex items-center gap-3 mt-3">
        {/* Add Media */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 text-primary hover:text-primary/80 text-sm font-medium transition-colors"
        >
          {mediaIsVideo ? <Video className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
          {media ? "Change Media" : <><span className="text-red-500 mr-0.5">*</span>Add Photo / Video</>}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={handleMediaChange}
        />

        {/* Privacy dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setPrivacyOpen((o) => !o)}
            className="flex items-center gap-1.5 text-muted hover:text-foreground text-sm transition-colors"
          >
            <PrivacyIcon className="w-4 h-4" />
            {currentPrivacy.label}
            <ChevronDown className="w-3 h-3" />
          </button>

          {privacyOpen && (
            <div className="absolute bottom-full left-0 mb-2 w-44 bg-background border border-border rounded-xl shadow-xl z-20 overflow-hidden py-1">
              {PRIVACY_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setPrivacy(opt.value); setPrivacyOpen(false); }}
                    className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left hover:bg-foreground/5 transition-colors ${
                      privacy === opt.value ? "text-primary font-medium" : "text-foreground/70"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Post button */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!media || content.length > 500 || submitting}
          className="ml-auto bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-bold text-sm transition-all flex items-center gap-2"
        >
          {submitting ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Posting...
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Post
            </>
          )}
        </button>
      </div>
    </div>
  );
}
