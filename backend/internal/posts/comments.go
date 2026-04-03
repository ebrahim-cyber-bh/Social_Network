package posts

import (
	"backend/internal/db/queries"
	"backend/internal/models"
	"backend/internal/utils"
	"backend/internal/ws"
	"net/http"
	"strconv"
)

// GetComments handles GET /api/posts/{id}/comments
func GetComments(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	postIDStr := r.PathValue("id")
	postID, err := strconv.ParseInt(postIDStr, 10, 64)
	if err != nil {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{
			Success: false,
			Message: "Invalid post ID",
		})
		return
	}

	rawComments, err := queries.GetComments(postID)
	if err != nil {
		utils.RespondJSON(w, http.StatusInternalServerError, models.GenericResponse{
			Success: false,
			Message: "Failed to fetch comments",
		})
		return
	}

	result := make([]models.Comment, 0, len(rawComments))
	for _, c := range rawComments {
		author, err := queries.GetUserByID(c.UserID)
		if err == nil {
			c.Author = &author
		}
		result = append(result, c)
	}

	utils.RespondJSON(w, http.StatusOK, map[string]interface{}{
		"success":  true,
		"comments": result,
	})
}

// AddComment handles POST /api/posts/{id}/comments
// Accepts JSON: { content }
func AddComment(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := utils.GetUserIDFromContext(r)
	if !ok || userID == 0 {
		utils.RespondJSON(w, http.StatusUnauthorized, models.GenericResponse{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	postIDStr := r.PathValue("id")
	postID, err := strconv.ParseInt(postIDStr, 10, 64)
	if err != nil {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{
			Success: false,
			Message: "Invalid post ID",
		})
		return
	}

	var body struct {
		Content string `json:"content"`
	}
	if err := utils.ParseJSON(r, &body); err != nil || len(body.Content) == 0 {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{
			Success: false,
			Message: "Comment content is required",
		})
		return
	}

	if len(body.Content) > 300 {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{
			Success: false,
			Message: "Comment must be 300 characters or less",
		})
		return
	}

	commentID, err := queries.AddComment(postID, userID, body.Content)
	if err != nil {
		utils.RespondJSON(w, http.StatusInternalServerError, models.GenericResponse{
			Success: false,
			Message: "Failed to add comment",
		})
		return
	}

	// Broadcast comment notification to post author
	postOwnerID, err := queries.GetPostOwnerID(postID)
	if err == nil && postOwnerID != userID {
		// Only notify if not commenting on own post
		commenter, err := queries.GetUserByID(userID)
		if err == nil {
			commenterName := commenter.FirstName + " " + commenter.LastName
			ws.BroadcastPostComment(postOwnerID, userID, commenterName, &commenter.Avatar, int(postID), body.Content)
		}
	}

	utils.RespondJSON(w, http.StatusCreated, map[string]interface{}{
		"success":    true,
		"message":    "Comment added",
		"comment_id": commentID,
	})
}

// DeleteComment handles DELETE /api/posts/{id}/comments/{commentId}
// Works for both top-level comments and replies (same table).
func DeleteComment(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := utils.GetUserIDFromContext(r)
	if !ok || userID == 0 {
		utils.RespondJSON(w, http.StatusUnauthorized, models.GenericResponse{Success: false, Message: "Unauthorized"})
		return
	}

	commentIDStr := r.PathValue("commentId")
	commentID, err := strconv.ParseInt(commentIDStr, 10, 64)
	if err != nil {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{Success: false, Message: "Invalid comment ID"})
		return
	}

	if err := queries.DeleteComment(commentID, userID); err != nil {
		utils.RespondJSON(w, http.StatusForbidden, models.GenericResponse{Success: false, Message: "Not found or you don't own this comment"})
		return
	}

	utils.RespondJSON(w, http.StatusOK, models.GenericResponse{Success: true, Message: "Comment deleted"})
}

// UpdateComment handles PUT /api/posts/{id}/comments/{commentId}
// Works for both top-level comments and replies.
// Accepts JSON: { content }
func UpdateComment(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := utils.GetUserIDFromContext(r)
	if !ok || userID == 0 {
		utils.RespondJSON(w, http.StatusUnauthorized, models.GenericResponse{Success: false, Message: "Unauthorized"})
		return
	}

	commentIDStr := r.PathValue("commentId")
	commentID, err := strconv.ParseInt(commentIDStr, 10, 64)
	if err != nil {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{Success: false, Message: "Invalid comment ID"})
		return
	}

	var body struct {
		Content string `json:"content"`
	}
	if err := utils.ParseJSON(r, &body); err != nil || len(body.Content) == 0 {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{Success: false, Message: "Content is required"})
		return
	}
	if len(body.Content) > 300 {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{Success: false, Message: "Content must be 300 characters or less"})
		return
	}

	if err := queries.UpdateComment(commentID, userID, body.Content); err != nil {
		utils.RespondJSON(w, http.StatusForbidden, models.GenericResponse{Success: false, Message: "Not found or you don't own this comment"})
		return
	}

	utils.RespondJSON(w, http.StatusOK, models.GenericResponse{Success: true, Message: "Comment updated"})
}

// GetReplies handles GET /api/posts/{id}/comments/{commentId}/replies
func GetReplies(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	commentIDStr := r.PathValue("commentId")
	commentID, err := strconv.ParseInt(commentIDStr, 10, 64)
	if err != nil {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{
			Success: false,
			Message: "Invalid comment ID",
		})
		return
	}

	rawReplies, err := queries.GetReplies(commentID)
	if err != nil {
		utils.RespondJSON(w, http.StatusInternalServerError, models.GenericResponse{
			Success: false,
			Message: "Failed to fetch replies",
		})
		return
	}

	result := make([]models.Comment, 0, len(rawReplies))
	for _, c := range rawReplies {
		author, err := queries.GetUserByID(c.UserID)
		if err == nil {
			c.Author = &author
		}
		result = append(result, c)
	}

	utils.RespondJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"replies": result,
	})
}

// AddReply handles POST /api/posts/{id}/comments/{commentId}/replies
// Accepts JSON: { content }
func AddReply(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	userID, ok := utils.GetUserIDFromContext(r)
	if !ok || userID == 0 {
		utils.RespondJSON(w, http.StatusUnauthorized, models.GenericResponse{
			Success: false,
			Message: "Unauthorized",
		})
		return
	}

	postIDStr := r.PathValue("id")
	postID, err := strconv.ParseInt(postIDStr, 10, 64)
	if err != nil {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{
			Success: false,
			Message: "Invalid post ID",
		})
		return
	}

	commentIDStr := r.PathValue("commentId")
	commentID, err := strconv.ParseInt(commentIDStr, 10, 64)
	if err != nil {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{
			Success: false,
			Message: "Invalid comment ID",
		})
		return
	}

	var body struct {
		Content string `json:"content"`
	}
	if err := utils.ParseJSON(r, &body); err != nil || len(body.Content) == 0 {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{
			Success: false,
			Message: "Reply content is required",
		})
		return
	}

	if len(body.Content) > 300 {
		utils.RespondJSON(w, http.StatusBadRequest, models.GenericResponse{
			Success: false,
			Message: "Reply must be 300 characters or less",
		})
		return
	}

	replyID, err := queries.AddReply(postID, commentID, userID, body.Content)
	if err != nil {
		utils.RespondJSON(w, http.StatusInternalServerError, models.GenericResponse{
			Success: false,
			Message: "Failed to add reply",
		})
		return
	}

	// Broadcast reply notification to comment author
	commentAuthorID, err := queries.GetCommentOwnerID(commentID)
	if err == nil && commentAuthorID != userID {
		// Only notify if not replying to own comment
		replier, err := queries.GetUserByID(userID)
		if err == nil {
			replierName := replier.FirstName + " " + replier.LastName
			ws.BroadcastCommentReply(commentAuthorID, userID, replierName, &replier.Avatar, int(postID), body.Content, commentID)
		}
	}

	utils.RespondJSON(w, http.StatusCreated, map[string]interface{}{
		"success":  true,
		"message":  "Reply added",
		"reply_id": replyID,
	})
}
