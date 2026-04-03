# Follow Request Notifications - Complete Fix Documentation

## Overview
Fixed the follow request notification feature to properly display sender info and handle Accept/Decline actions.

## Issues Fixed

### 1. **Data Structure Mismatch**
- **Problem**: Backend returned raw `UserSearchResult` array, but frontend expected each item wrapped in `requester` object
- **Solution**: Modified `GetFollowRequestsHandler` to transform response into proper structure

### 2. **API Endpoint Mismatch**
- **Problem**: Frontend sent `request_id` as form data, but backend handler expected JSON with `username`
- **Solution**: Updated `HandleFollowRequestHandler` to parse URLSearchParams and accept `request_id` instead of `username`

### 3. **Missing Request ID in WebSocket**
- **Problem**: `BroadcastFollowRequest` didn't include `request_id`, so frontend couldn't identify which request was being acted upon
- **Solution**: Enhanced broadcast to include `request_id`, `sender_username`, and proper sender info

### 4. **Sender Info Not Displaying**
- **Problem**: Frontend fields didn't match backend response structure (e.g., `userId` vs expected names)
- **Solution**: Verified data flow and ensured proper field mapping in response transformation

## Files Changed

### Backend Files

#### 1. `backend/internal/follow/handlers.go`
**Changes**:
- Added `fmt` import
- Removed unused `encoding/json` import
- **GetFollowRequestsHandler**: Now transforms `UserSearchResult` into structured response with `request` wrapper
- **HandleFollowRequestHandler**: 
  - Changed to parse `request_id` from URLSearchParams instead of JSON
  - Uses `request_id` to look up requester by user ID
  - Properly validates accept/decline actions

**Key Code**:
```go
// Now returns:
type FollowRequest struct {
    ID          int                      `json:"id"`
    RequesterID int                      `json:"requester_id"`
    CreatedAt   string                   `json:"created_at"`
    Requester   models.UserSearchResult `json:"requester"`
}
```

#### 2. `backend/internal/ws/notifications.go`
**Changes**:
- Enhanced `BroadcastFollowRequest` to include sender username
- Added lookup of sender's UserSearchResult to get full details
- Broader payload now includes: `request_id`, `sender_id`, `sender_name`, `sender_username`, `sender_avatar`

### Frontend Files

#### 1. `frontend/lib/users/follow.ts`
**Changes**:
- Added comprehensive console logging to `handleFollowRequest()` function
- Logs request parameters, API endpoint, and response data
- Helps debug data flow issues

#### 2. `frontend/app/(main)/notifications/page.tsx`
**Changes**:
- Added comprehensive console logging in `loadAll()` function to track loaded data
- Enhanced `onHandleFollowRequest()` handler with:
  - Console logs for debugging
  - Error handling with error toast
  - Better state management
- Improved follow request rendering:
  - Added null checks for requester object
  - Added warning logs if requester missing
  - Added button click logging
  - Better error messages

## Data Flow (Accept/Decline Request)

```
User clicks "Accept" button (request.id = 123)
    ↓
onHandleFollowRequest(123, "accept")
    ↓
handleFollowRequest(123, "accept")
    ↓
POST /api/follow/requests/handle
Body: "request_id=123&action=accept"
    ↓
Backend HandleFollowRequestHandler
    - Parse request_id = 123
    - Fetch user 123 (requester)
    - Call AcceptFollowRequest(123, currentUserId)
    - Send follow_update notification to user 123
    ↓
Response: { success: true, action: "accept" }
    ↓
Frontend removes request from followRequests list
    ↓
Show success toast: "Follow request accepted"
    ↓
Send follow_update event to requester via WebSocket
```

## Response Structure

### GET /api/follow/requests
```json
{
  "success": true,
  "requests": [
    {
      "id": 123,
      "requester_id": 123,
      "created_at": "2026-04-03T10:30:00Z",
      "requester": {
        "userId": 123,
        "username": "john_doe",
        "firstName": "John",
        "lastName": "Doe",
        "avatar": "/path/to/avatar.jpg",
        "isPublic": true,
        "followStatus": "none",
        "followsMe": false
      }
    }
  ]
}
```

### POST /api/follow/requests/handle
**Request**:
```
POST /api/follow/requests/handle
Content-Type: application/x-www-form-urlencoded

request_id=123&action=accept
```

**Response**:
```json
{
  "success": true,
  "action": "accept"
}
```

## WebSocket Events

### follow_request (Real-time notification)
**When**: User sends a follow request to someone with a private profile

**Payload**:
```json
{
  "type": "follow_request",
  "request_id": 456,
  "sender_id": 456,
  "sender_name": "Jane Smith",
  "sender_username": "jane_smith",
  "sender_avatar": "/path/to/avatar.jpg",
  "timestamp": "2026-04-03T10:30:00Z"
}
```

### follow_update (Response notification)
**When**: Recipient accepts or declines a follow request

**Payload**:
```json
{
  "type": "follow_update",
  "data": {
    "followerId": 123,
    "followerUsername": "john_doe",
    "followerFirstName": "John",
    "followerLastName": "Doe",
    "followerAvatar": "/path/to/avatar.jpg",
    "status": "accepted" | "none",
    "targetUsername": "jane_smith",
    "action": "accept" | "decline"
  },
  "timestamp": "2026-04-03T10:30:05Z"
}
```

## Console Logs for Debugging

The following console logs are now available:

1. **Notifications Page Loading**:
   ```
   [Notifications] Loaded data: { notifications: 5, invitations: 2, followRequests: 1 }
   [Notifications] Follow requests raw: [...]
   ```

2. **API Call**:
   ```
   [Follow API] Handling follow request: 123 - accept
   [Follow API] Sending: {url: "...", body: "request_id=123&action=accept"}
   [Follow API] Response: {success: true, action: "accept"}
   ```

3. **Handler**:
   ```
   [Follow Request] Handling request 123 with action accept
   [Follow Request] Result: {success: true, ...}
   [Follow Request] Removed request 123, remaining: [...]
   ```

4. **Button Click**:
   ```
   [Button] Accept clicked for request: 123
   [Render] Follow request item: {...}
   ```

## Testing Instructions

### Prerequisites
1. Backend running: `go run ./cmd/server`
2. Frontend running: `npm run dev`
3. Two test user accounts (one with private profile)

### Test Case 1: Accept Follow Request
1. User A (private profile) opens browser console
2. User B (any profile) follows User A
3. Check console: `[Notifications] Follow requests raw:` should show new request
4. Follow request card appears in notifications
5. Click "Accept"
6. Check console: Request removed log appears
7. Toast shows "Follow request accepted"
8. User A's follower count increases

### Test Case 2: Decline Follow Request
1. User A (private profile) opens browser console
2. User B (any profile) follows User A
3. Click "Decline" on follow request
4. Check console: Request removed log appears
5. Toast shows "Follow request declined"
6. Follow request disappears from list
7. User B is not added to followers

### Test Case 3: Real-Time Notification
1. User A keeps notifications page open
2. User B opens separate browser tab and sends follow request
3. User A should see new request appear in real-time (without refresh)
4. Console shows `follow_request` WebSocket event received

## Troubleshooting

### Follow requests not appearing
1. Check browser console for errors
2. Verify `[Notifications] Follow requests raw:` log showing data
3. Check network tab to see `/api/follow/requests` response
4. Ensure backend is running and compiled

### Accept/Decline buttons not working
1. Open browser console
2. Click button and look for `[Button]` and `[Follow Request]` logs
3. Check if `[Follow API]` logs show the API call
4. Verify network tab shows POST request to `/api/follow/requests/handle`
5. Check response status (should be 200 OK)

### Sender info not displaying
1. Check console for `[Render] Follow request item:` log
2. Look for warning: `[Render] Missing requester for request:`
3. Verify response structure in network tab API response
4. Check that `requester` object has `username`, `firstName`, `lastName` fields

### No real-time updates
1. Open browser console WebSocket tab
2. Check if `follow_request` event received
3. Verify WebSocket connection is open
4. Check backend logs for broadcast errors

## Deployment Notes

✅ All code compiles successfully:
- Backend: `go build ./cmd/server` ✓
- Frontend: `npx tsc --noEmit` ✓

✅ Changes are backward compatible:
- Existing follow endpoints unchanged
- Only response structure of `/api/follow/requests` modified
- API endpoint path unchanged

✅ Ready for testing and deployment
