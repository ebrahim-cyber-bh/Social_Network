package ws

import (
	"backend/internal/db/queries"
	"backend/internal/models"
	"fmt"
)

// HandleTyping broadcasts a group typing signal to connected clients.
func HandleTyping(session *models.Session, msg map[string]interface{}) {
	groupIDRaw, ok := msg["group_id"].(float64)
	if !ok {
		fmt.Println("Invalid or missing group_id for typing event")
		return
	}
	groupID := int(groupIDRaw)

	// Only group members can emit typing events for that group.
	isMember, err := queries.IsUserGroupMember(groupID, session.UserID)
	if err != nil || !isMember {
		return
	}

	userName := "Someone"
	if user, err := queries.GetUserByID(session.UserID); err == nil {
		if user.Username != "" {
			userName = user.Username
		}
	}

	BroadcastToAll(map[string]interface{}{
		"type":      "user_typing",
		"group_id":  groupID,
		"user_id":   session.UserID,
		"user_name": userName,
	})
}

// HandleStopTyping broadcasts a group stop-typing signal to connected clients.
func HandleStopTyping(session *models.Session, msg map[string]interface{}) {
	groupIDRaw, ok := msg["group_id"].(float64)
	if !ok {
		return
	}
	groupID := int(groupIDRaw)

	isMember, err := queries.IsUserGroupMember(groupID, session.UserID)
	if err != nil || !isMember {
		return
	}

	BroadcastToAll(map[string]interface{}{
		"type":     "user_stop_typing",
		"group_id": groupID,
		"user_id":  session.UserID,
	})
}
