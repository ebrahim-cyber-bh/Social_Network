package ws

import (
	"backend/internal/db/queries"
	"backend/internal/models"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gorilla/websocket"
)

// BroadcastToGroup sends a notification to all members of a group
func BroadcastToGroup(groupID int64, messageType string, data interface{}) {
	// Run in a goroutine to not block the caller
	go func() {
		members, err := queries.GetGroupMembersWithDetails(groupID)
		if err != nil {
			fmt.Printf("Error fetching members for notification: %v\n", err)
			return
		}

		notification := models.NotificationMessage{
			Type:      messageType,
			Data:      data,
			Timestamp: time.Now(),
		}

		fmt.Printf("Broadcasting %s to group %d (%d members)\n", messageType, groupID, len(members))

		for _, member := range members {
			SendNotificationToUser(member.UserID, notification)
		}
	}()
}

// BroadcastRawToGroup sends a pre-shaped WebSocket payload to online group members.
func BroadcastRawToGroup(groupID int64, message interface{}) {
	go func() {
		members, err := queries.GetGroupMembersWithDetails(groupID)
		if err != nil {
			fmt.Printf("Error fetching group members for broadcast: %v\n", err)
			return
		}

		payload, err := json.Marshal(message)
		if err != nil {
			fmt.Printf("Error marshaling group broadcast payload: %v\n", err)
			return
		}

		for _, member := range members {
			mu.Lock()
			sConn, ok := OnlineUsers[member.UserID]
			mu.Unlock()
			if !ok {
				continue
			}

			if err := sConn.WriteMessage(websocket.TextMessage, payload); err != nil {
				fmt.Printf("Failed group broadcast to user %d: %v\n", member.UserID, err)
				mu.Lock()
				delete(OnlineUsers, member.UserID)
				mu.Unlock()
			}
		}
	}()
}

// SendNotificationToUser sends a notification to a specific user via WebSocket
func SendNotificationToUser(userID int, notification models.NotificationMessage) {
	mu.Lock()
	conn, ok := OnlineUsers[userID]
	mu.Unlock()

	if !ok {
		fmt.Printf("User %d is not online, cannot send notification\n", userID)
		return
	}

	data, err := json.Marshal(notification)
	if err != nil {
		fmt.Printf("Error marshaling notification: %v\n", err)
		return
	}

	err = conn.WriteMessage(websocket.TextMessage, data)
	if err != nil {
		// Connection might be closed, remove from online users
		mu.Lock()
		delete(OnlineUsers, userID)
		mu.Unlock()
		fmt.Printf("Failed to send notification to user %d: %v\n", userID, err)
	} else {
		fmt.Printf("Successfully sent notification to user %d\n", userID)
	}
}

// BroadcastFollowRequest notifies a user of a follow request
func BroadcastFollowRequest(recipientID int, senderID int, senderName string, senderAvatar *string) {
	go func() {
		// Get sender's username
		sender, err := queries.GetUserByID(senderID)
		senderUsername := ""
		if err == nil {
			senderUsername = sender.Username
		}

		notification := map[string]interface{}{
			"type":            "follow_request",
			"request_id":      senderID, // The request ID is the sender's user ID
			"sender_id":       senderID,
			"sender_name":     senderName,
			"sender_username": senderUsername,
			"sender_avatar":   senderAvatar,
			"timestamp":       time.Now(),
		}

		mu.Lock()
		if sConn, ok := OnlineUsers[recipientID]; ok {
			mu.Unlock()
			payload, _ := json.Marshal(notification)
			sConn.WriteMessage(websocket.TextMessage, payload)
		} else {
			mu.Unlock()
		}
	}()
}

// BroadcastMessageNotification notifies user of a new message (also stores in DB)
func BroadcastMessageNotification(recipientID int, senderID int, senderName string, content string, conversationID int) {
	go func() {
		// Store in database
		data := fmt.Sprintf(`{"sender_id":%d,"sender_name":"%s","content":"%s","conversation_id":%d}`, senderID, senderName, content, conversationID)
		queries.CreateNotification(recipientID, &senderID, "new_message", data)

		notification := map[string]interface{}{
			"type":            "new_message",
			"sender_id":       senderID,
			"sender_name":     senderName,
			"content":         content,
			"conversation_id": conversationID,
			"timestamp":       time.Now(),
		}

		mu.Lock()
		if sConn, ok := OnlineUsers[recipientID]; ok {
			mu.Unlock()
			payload, _ := json.Marshal(notification)
			sConn.WriteMessage(websocket.TextMessage, payload)
		} else {
			mu.Unlock()
		}
	}()
}

// BroadcastPostLike notifies post author of a like
func BroadcastPostLike(postAuthorID int, likerID int, likerName string, likerAvatar *string, postID int) {
	go func() {
		// Store in database with properly encoded JSON
		dataMap := map[string]interface{}{
			"liker_id":   likerID,
			"liker_name": likerName,
			"post_id":    postID,
		}
		dataBytes, _ := json.Marshal(dataMap)
		err := queries.CreateNotification(postAuthorID, &likerID, "post_like", string(dataBytes))
		if err != nil {
			fmt.Printf("Failed to create post_like notification: %v\n", err)
		}

		notification := map[string]interface{}{
			"type":         "post_like",
			"liker_id":     likerID,
			"liker_name":   likerName,
			"liker_avatar": likerAvatar,
			"post_id":      postID,
			"timestamp":    time.Now(),
		}

		mu.Lock()
		if sConn, ok := OnlineUsers[postAuthorID]; ok {
			mu.Unlock()
			payload, _ := json.Marshal(notification)
			sConn.WriteMessage(websocket.TextMessage, payload)
		} else {
			mu.Unlock()
		}
	}()
}

// BroadcastPostComment notifies post author of a comment
func BroadcastPostComment(postAuthorID int, commenterID int, commenterName string, commenterAvatar *string, postID int, commentText string) {
	go func() {
		// Store in database with properly encoded JSON
		dataMap := map[string]interface{}{
			"commenter_id":   commenterID,
			"commenter_name": commenterName,
			"post_id":        postID,
			"comment":        commentText,
		}
		dataBytes, _ := json.Marshal(dataMap)
		err := queries.CreateNotification(postAuthorID, &commenterID, "post_comment", string(dataBytes))
		if err != nil {
			fmt.Printf("Failed to create post_comment notification: %v\n", err)
		}

		notification := map[string]interface{}{
			"type":             "post_comment",
			"commenter_id":     commenterID,
			"commenter_name":   commenterName,
			"commenter_avatar": commenterAvatar,
			"post_id":          postID,
			"comment_text":     commentText,
			"timestamp":        time.Now(),
		}

		mu.Lock()
		if sConn, ok := OnlineUsers[postAuthorID]; ok {
			mu.Unlock()
			payload, _ := json.Marshal(notification)
			sConn.WriteMessage(websocket.TextMessage, payload)
		} else {
			mu.Unlock()
		}
	}()
}

// BroadcastCommentReply notifies a comment author when someone replies to their comment
func BroadcastCommentReply(commentAuthorID int, replierID int, replierName string, replierAvatar *string, postID int, replyText string, commentID int64) {
	go func() {
		// Store in database with properly encoded JSON
		dataMap := map[string]interface{}{
			"replier_id":   replierID,
			"replier_name": replierName,
			"post_id":      postID,
			"comment_id":   commentID,
			"reply":        replyText,
		}
		dataBytes, _ := json.Marshal(dataMap)
		err := queries.CreateNotification(commentAuthorID, &replierID, "comment_reply", string(dataBytes))
		if err != nil {
			fmt.Printf("Failed to create comment_reply notification: %v\n", err)
		}

		notification := map[string]interface{}{
			"type":           "comment_reply",
			"replier_id":     replierID,
			"replier_name":   replierName,
			"replier_avatar": replierAvatar,
			"post_id":        postID,
			"comment_id":     commentID,
			"reply_text":     replyText,
			"timestamp":      time.Now(),
		}

		mu.Lock()
		if sConn, ok := OnlineUsers[commentAuthorID]; ok {
			mu.Unlock()
			payload, _ := json.Marshal(notification)
			sConn.WriteMessage(websocket.TextMessage, payload)
		} else {
			mu.Unlock()
		}
	}()
}

// BroadcastMention notifies a user they were mentioned
func BroadcastMention(mentionedUserID int, mentionerID int, mentionerName string, mentionerAvatar *string, context string, contextType string) {
	go func() {
		// Store in database
		data := fmt.Sprintf(`{"mentioner_id":%d,"mentioner_name":"%s","context":"%s","context_type":"%s"}`, mentionerID, mentionerName, context, contextType)
		queries.CreateNotification(mentionedUserID, &mentionerID, "mention", data)

		notification := map[string]interface{}{
			"type":             "mention",
			"mentioner_id":     mentionerID,
			"mentioner_name":   mentionerName,
			"mentioner_avatar": mentionerAvatar,
			"context":          context,
			"context_type":     contextType,
			"timestamp":        time.Now(),
		}

		mu.Lock()
		if sConn, ok := OnlineUsers[mentionedUserID]; ok {
			mu.Unlock()
			payload, _ := json.Marshal(notification)
			sConn.WriteMessage(websocket.TextMessage, payload)
		} else {
			mu.Unlock()
		}
	}()
}

// BroadcastGroupPost notifies group members of a new post
func BroadcastGroupPost(groupID int64, posterID int, posterName string, posterAvatar *string, postContent string) {
	go func() {
		members, err := queries.GetGroupMembersWithDetails(groupID)
		if err != nil {
			fmt.Printf("Failed to get group members: %v\n", err)
			return
		}

		// Create database notification for each group member
		dataMap := map[string]interface{}{
			"poster_id":   posterID,
			"poster_name": posterName,
			"group_id":    groupID,
			"content":     postContent,
		}
		dataBytes, _ := json.Marshal(dataMap)
		dataStr := string(dataBytes)

		notification := map[string]interface{}{
			"type":          "group_post",
			"group_id":      groupID,
			"poster_id":     posterID,
			"poster_name":   posterName,
			"poster_avatar": posterAvatar,
			"post_content":  postContent,
			"timestamp":     time.Now(),
		}

		payload, _ := json.Marshal(notification)

		for _, member := range members {
			if member.UserID == posterID {
				continue // Don't notify the poster
			}

			// Store in database
			err := queries.CreateNotification(member.UserID, &posterID, "group_post", dataStr)
			if err != nil {
				fmt.Printf("Failed to create group_post notification: %v\n", err)
			}

			// Broadcast to online users
			mu.Lock()
			if sConn, ok := OnlineUsers[member.UserID]; ok {
				mu.Unlock()
				sConn.WriteMessage(websocket.TextMessage, payload)
			} else {
				mu.Unlock()
			}
		}
	}()
}

// BroadcastEventReminder notifies group members of an upcoming event
func BroadcastEventReminder(groupID int64, eventID int, eventName string, eventTime time.Time, creatorName string) {
	go func() {
		members, err := queries.GetGroupMembersWithDetails(groupID)
		if err != nil {
			return
		}

		notification := map[string]interface{}{
			"type":         "event_reminder",
			"group_id":     groupID,
			"event_id":     eventID,
			"event_name":   eventName,
			"event_time":   eventTime,
			"creator_name": creatorName,
			"timestamp":    time.Now(),
		}

		payload, _ := json.Marshal(notification)

		for _, member := range members {
			mu.Lock()
			if sConn, ok := OnlineUsers[member.UserID]; ok {
				mu.Unlock()
				sConn.WriteMessage(websocket.TextMessage, payload)
			} else {
				mu.Unlock()
			}
		}
	}()
}
