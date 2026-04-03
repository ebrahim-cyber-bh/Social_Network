import { API_URL } from "@/lib/config";
import type { UserSearchResult } from "@/lib/users/search";

export interface FollowResponse {
  success: boolean;
  status?: "none" | "pending" | "accepted";
  message?: string;
}

export interface FollowListResponse {
  success: boolean;
  count: number;
  followers?: UserSearchResult[];
  following?: UserSearchResult[];
}

/** Follow a user by username. Returns new follow status. */
export async function followUser(username: string): Promise<FollowResponse> {
  try {
    const res = await fetch(`${API_URL}/api/follow/${encodeURIComponent(username)}`, {
      method: "POST",
      credentials: "include",
    });
    return await res.json();
  } catch {
    return { success: false, message: "Network error" };
  }
}

/** Unfollow a user by username. */
export async function unfollowUser(username: string): Promise<FollowResponse> {
  try {
    const res = await fetch(`${API_URL}/api/follow/${encodeURIComponent(username)}`, {
      method: "DELETE",
      credentials: "include",
    });
    return await res.json();
  } catch {
    return { success: false, message: "Network error" };
  }
}

/** Get the followers list for a given username. */
export async function getFollowers(username: string): Promise<FollowListResponse> {
  try {
    const res = await fetch(
      `${API_URL}/api/users/${encodeURIComponent(username)}/followers`,
      { credentials: "include" },
    );
    return await res.json();
  } catch {
    return { success: false, count: 0, followers: [] };
  }
}

/** Get the following list for a given username. */
export async function getFollowing(username: string): Promise<FollowListResponse> {
  try {
    const res = await fetch(
      `${API_URL}/api/users/${encodeURIComponent(username)}/following`,
      { credentials: "include" },
    );
    return await res.json();
  } catch {
    return { success: false, count: 0, following: [] };
  }
}

/** Get pending follow requests */
export async function getFollowRequests(): Promise<{
  success: boolean;
  requests?: Array<{
    id: number;
    requester_id: number;
    created_at: string;
    requester?: {
      userId: number;
      username: string;
      firstName: string;
      lastName: string;
      avatar?: string;
    };
  }>;
}> {
  try {
    const res = await fetch(`${API_URL}/api/follow/requests`, {
      credentials: "include",
    });
    return await res.json();
  } catch {
    return { success: false, requests: [] };
  }
}

/** Handle follow request (accept or decline) */
export async function handleFollowRequest(
  requestId: number,
  action: "accept" | "decline"
): Promise<FollowResponse> {
  try {
    console.log(`[Follow API] Handling follow request: ${requestId} - ${action}`);
    
    const body = new URLSearchParams();
    body.set("request_id", String(requestId));
    body.set("action", action);

    console.log(`[Follow API] Sending:`, {
      url: `${API_URL}/api/follow/requests/handle`,
      body: body.toString(),
    });

    const res = await fetch(`${API_URL}/api/follow/requests/handle`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    
    const result = await res.json();
    console.log(`[Follow API] Response:`, result);
    return result;
  } catch (error) {
    console.error(`[Follow API] Error:`, error);
    return { success: false, message: "Network error" };
  }
}
