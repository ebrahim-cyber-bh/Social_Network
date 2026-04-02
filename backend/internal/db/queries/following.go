package queries

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
