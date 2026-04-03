package groups

import (
	"backend/internal/db/queries"
	"backend/internal/models"
	"backend/internal/utils"
	"backend/internal/ws"
	"net/http"
	"strconv"
	"strings"
)

func PostLike(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		utils.RespondJSON(w, http.StatusMethodNotAllowed, models.GenericResponse{
			Success: false,
			Message: "Method not allowed",
		})
		return
	}

	userID, ok := utils.GetUserIDFromContext(r)
	if !ok {
		utils.RespondJSON(w, http.StatusUnauthorized, models.GenericResponse{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	// Extract post ID from URL path: /posts/{id}/like
	pathParts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(pathParts) < 2 {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{
			Success: false,
			Message: "Invalid post ID",
		})
		return
	}

	postID, err := strconv.ParseInt(pathParts[1], 10, 64)
	if err != nil {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{
			Success: false,
			Message: "Invalid post ID",
		})
		return
	}

	// Toggle the like
	isLiked, err := queries.TogglePostLike(postID, userID)
	if err != nil {
		utils.RespondJSON(w, http.StatusInternalServerError, models.GenericResponse{
			Success: false,
			Message: "Failed to toggle like",
		})
		return
	}

	// Get updated like count
	likesCount, err := queries.GetPostLikesCount(postID)
	if err != nil {
		utils.RespondJSON(w, http.StatusInternalServerError, models.GenericResponse{
			Success: false,
			Message: "Failed to get likes count",
		})
		return
	}

	// Broadcast like notification if this is a new like
	if isLiked {
		postOwnerID, err := queries.GetPostOwnerID(postID)
		if err == nil && postOwnerID != userID {
			// Only notify if not liking own post
			liker, err := queries.GetUserByID(userID)
			if err == nil {
				likerName := liker.FirstName + " " + liker.LastName
				ws.BroadcastPostLike(postOwnerID, userID, likerName, &liker.Avatar, int(postID))
			}
		}
	}

	utils.RespondJSON(w, http.StatusOK, map[string]interface{}{
		"success":  true,
		"is_liked": isLiked,
		"likes":    likesCount,
	})
}
