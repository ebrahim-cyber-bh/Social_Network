package users

import (
	"backend/internal/db/queries"
	"backend/internal/models"
	"backend/internal/utils"
	"net/http"
)

// GetFollowingHandler handles GET /api/users/following
// Returns the IDs of users that the current user follows (accepted only).
func GetFollowingHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := utils.GetUserIDFromContext(r)
	if !ok || userID == 0 {
		utils.RespondJSON(w, http.StatusUnauthorized, models.GenericResponse{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	ids, err := queries.GetFollowingIDs(userID)
	if err != nil {
		utils.RespondJSON(w, http.StatusInternalServerError, models.GenericResponse{
			Success: false,
			Message: "Failed to fetch following list",
		})
		return
	}

	if ids == nil {
		ids = []int{}
	}

	utils.RespondJSON(w, http.StatusOK, map[string]interface{}{
		"success":      true,
		"following_ids": ids,
	})
}
