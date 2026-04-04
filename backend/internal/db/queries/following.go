package queries

import "backend/internal/models"

// GetFollowersWithDetails returns full user records for everyone who follows userID (accepted).
func GetFollowersWithDetails(userID int) ([]models.User, error) {
	rows, err := DB.Query(`
		SELECT u.id, u.email, u.username, '',
		       u.first_name, u.last_name,
		       COALESCE(u.date_of_birth, '') AS date_of_birth,
		       COALESCE(u.nickname, '')       AS nickname,
		       COALESCE(u.avatar, '')         AS avatar,
		       COALESCE(u.about_me, '')       AS about_me,
		       u.is_public,
		       COALESCE(u.is_verified, 0)     AS is_verified,
		       u.created_at
		FROM followers f
		JOIN users u ON u.id = f.follower_id
		WHERE f.following_id = ? AND f.status = 'accepted'
		ORDER BY u.first_name, u.last_name
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var u models.User
		if err := rows.Scan(
			&u.ID, &u.Email, &u.Username, &u.Password,
			&u.FirstName, &u.LastName, &u.DateOfBirth,
			&u.Nickname, &u.Avatar, &u.AboutMe,
			&u.IsPublic, &u.IsVerified, &u.CreatedAt,
		); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// GetFollowingIDs returns the user IDs that userID follows with accepted status.
// Used to filter online friends on the feed page.
func GetFollowingIDs(userID int) ([]int, error) {
	rows, err := DB.Query(`
		SELECT following_id FROM followers
		WHERE follower_id = ? AND status = 'accepted'
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
